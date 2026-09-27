import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from 'src/environments/environment';
import { toTopicKey } from './topic-key';
import { EnglishLevel, englishLevelLabel } from './english-level';

// Vacíos si Gemini no los devolvió.
export interface WordDetails {
  example: string;
  confusables: string[];
}

export interface WordSuggestion extends WordDetails {
  word: string;
  translation: string;
  // Vacía si Gemini no la devolvió.
  imageQuery: string;
}

// Historia corta con las palabras de una sesión. Los párrafos van separados por saltos de línea.
export interface MiniStory {
  title: string;
  story: string;
  // Al español, para consultarla: se lee primero en inglés.
  translation: string;
}

const exampleProperty = {
  type: 'STRING',
  description: 'Frase corta en inglés (máximo 12 palabras) que contenga la palabra exacta'
};

// Las opciones falsas de los ejercicios: deben parecerse, pero viendo la imagen solo la palabra correcta puede valer.
const confusablesProperty = {
  type: 'ARRAY',
  items: { type: 'STRING' },
  description: 'Hasta 3 palabras en inglés, del mismo nivel, que un estudiante podría confundir con esta: de su misma categoría (knife → fork, spoon) o que se escriben o suenan parecido (shelf → shell). Nunca sinónimos ni otras formas de la misma palabra'
};

const wordsResponseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING', description: 'Palabra en inglés' },
      translation: { type: 'STRING', description: 'Traducción al español' },
      example: exampleProperty,
      // Klipy busca por las palabras del título de cada GIF: búsquedas largas se desvían ("draining pasta in colander" → un remolino).
      imageQuery: {
        type: 'STRING',
        description: 'Búsqueda de 2 o 3 palabras en inglés para encontrar su GIF: debe incluir la propia palabra y mostrarla de forma literal, como el título de un GIF. Ej.: "kitchen tongs", "man yawning", "red apple fruit"'
      },
      confusables: confusablesProperty
    },
    required: ['word', 'translation', 'example', 'imageQuery', 'confusables']
  }
};

const imagePicksResponseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING', description: 'La palabra tal como se pidió' },
      index: { type: 'INTEGER', description: 'Índice (desde 0) del GIF elegido, o -1 si ninguno sirve' }
    },
    required: ['word', 'index']
  }
};

const detailsResponseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING', description: 'La palabra tal como se pidió' },
      example: exampleProperty,
      confusables: confusablesProperty
    },
    required: ['word', 'example', 'confusables']
  }
};

const storyResponseSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Título corto en inglés' },
    story: { type: 'STRING', description: 'La historia en inglés, con los párrafos separados por un salto de línea' },
    translation: { type: 'STRING', description: 'Traducción al español de la historia, con los mismos párrafos' }
  },
  required: ['title', 'story', 'translation']
};

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private http = inject(HttpClient);

  // Generar 20 palabras con su JSON tarda unos segundos: pasado esto la conexión se da por colgada.
  private readonly requestTimeoutMs = 30000;

  async suggestTopics(excludedTopics: string[]): Promise<string[]> {
    const excludedText = excludedTopics.length
      ? ` No incluyas estos temas ya guardados: ${excludedTopics.join(', ')}.`
      : '';
    const text = await this.generateText(
      `Dame 6 temas nuevos y cortos en español para aprender vocabulario de ingles con imágenes.`
      + ' Cada tema debe ser una categoría amplia que agrupe muchas palabras distintas, nunca una palabra suelta ni un objeto (por ejemplo, "Frutas" y no "Manzana").'
      + ' Elige categorías cuyo vocabulario se pueda mostrar en un GIF y evita las abstractas (como "Economía" o "Política").'
      + ` Cada tema debe tener como máximo 1 palabra, ser claro y no incluir descripciones, explicaciones ni frases largas.${excludedText} Responde únicamente con la lista separada por comas.`
    );
    return this.parseTopics(text);
  }

  // Devuelve como máximo `count` palabras válidas, sin repetir entre sí ni con `excludedWords` (en minúsculas).
  async suggestWords(topic: string, count: number, excludedWords: Set<string>, level: EnglishLevel): Promise<WordSuggestion[]> {
    const text = await this.generateText(
      `Dame exactamente ${count} palabras de vocabulario en ingles de ${this.describeLevel(level)} sobre el tema "${topic}", cada una con su traduccion al español, una frase de ejemplo en inglés adecuada para ese nivel, una búsqueda para encontrar su GIF y las palabras con que se suele confundir.`
      + ' Las palabras se aprenden reconociéndolas en un GIF, así que elige solo palabras que se entiendan con solo ver la imagen: objetos, animales, lugares, acciones visibles o emociones con un gesto claro.'
      + ' Evita palabras abstractas o que necesiten contexto para entenderse (como "reliable", "achieve" o "concept").'
      + (excludedWords.size ? ` No incluyas estas palabras que ya tengo: ${[...excludedWords].join(', ')}.` : ''),
      { responseMimeType: 'application/json', responseSchema: wordsResponseSchema }
    );
    return this.parseWords(text, count, excludedWords);
  }

  // Para cada palabra, el índice del título de GIF que la muestra de forma más literal (-1 si ninguno sirve),
  // indexado por la palabra en minúsculas.
  async pickImages(items: { word: string; titles: string[] }[]): Promise<Map<string, number>> {
    const text = await this.generateText(
      'Para aprender vocabulario, cada palabra en inglés se muestra con un GIF y hay que reconocerla solo viéndolo.'
      + ' Para cada palabra tienes los títulos de varios GIFs candidatos. Elige el índice (desde 0) del GIF que muestre la palabra de forma más literal y reconocible.'
      + ' Descarta memes de famosos, series o dibujos animados y escenas donde la palabra sea secundaria. Si ninguno sirve, responde -1.\n'
      + JSON.stringify(items),
      { responseMimeType: 'application/json', responseSchema: imagePicksResponseSchema }
    );

    const picks = new Map<string, number>();
    for (const item of this.parseJsonArray(text)) {
      const word = typeof item?.word === 'string' ? item.word.trim().toLowerCase() : '';
      if (word && Number.isInteger(item?.index)) picks.set(word, item.index);
    }
    return picks;
  }

  // Truco para recordar una palabra con el método de la palabra clave: algo en español que suene como ella, unido a su
  // significado en una imagen mental. '' si no dio ninguno.
  async suggestMnemonic(word: string, translation: string): Promise<string> {
    const text = await this.generateText(
      `Crea un truco para que un hispanohablante recuerde la palabra inglesa "${word}" (${translation}) con el método de la palabra clave:`
      + ` elige una palabra o frase corta en español que suene parecido a cómo se pronuncia "${word}" en inglés y únela a su significado en una imagen mental vívida, concreta y fácil de visualizar.`
      + ' Escribe la palabra clave entre comillas latinas («»). Responde solo con el truco, en una o dos frases y como máximo 30 palabras, sin títulos, listas ni explicaciones.'
    );
    // Sin el formato de Markdown que a veces añade (negritas) ni comillas alrededor de todo.
    return text.replace(/\*+/g, '').replace(/\s+/g, ' ').trim().replace(/^"(.*)"$/, '$1');
  }

  // Frase de ejemplo y palabras confundibles para palabras guardadas antes de existir, indexadas por la palabra en minúsculas.
  async suggestDetails(words: string[], level: EnglishLevel): Promise<Map<string, WordDetails>> {
    const text = await this.generateText(
      `Para cada una de estas palabras en inglés, escribe una frase de ejemplo adecuada para un estudiante de ${this.describeLevel(level)} y las palabras con que se suele confundir: ${words.join(', ')}.`,
      { responseMimeType: 'application/json', responseSchema: detailsResponseSchema }
    );

    const details = new Map<string, WordDetails>();
    for (const item of this.parseJsonArray(text)) {
      const word = typeof item?.word === 'string' ? item.word.trim().toLowerCase() : '';
      if (!word) continue;
      details.set(word, {
        example: typeof item?.example === 'string' ? item.example.trim() : '',
        confusables: this.parseConfusables(item?.confusables, word)
      });
    }
    return details;
  }

  // Para leer al terminar una sesión: las palabras recién practicadas en contexto. null si no devolvió la historia.
  async writeStory(topic: string, words: string[], level: EnglishLevel): Promise<MiniStory | null> {
    const text = await this.generateText(
      `Escribe una historia muy corta en inglés (entre 80 y 150 palabras, en 2 o 3 párrafos) para un estudiante de ${this.describeLevel(level)} que acaba de practicar vocabulario del tema "${topic}".`
      + ` Usa todas estas palabras, cada una al menos una vez y de forma natural: ${words.join(', ')}.`
      + ' Que tenga un protagonista, algo que le ocurra y un final, con frases sencillas y gramática adecuada a ese nivel. Sin listas ni Markdown.',
      { responseMimeType: 'application/json', responseSchema: storyResponseSchema }
    );

    const parsed = this.parseJson(text) as Partial<Record<keyof MiniStory, unknown>> | undefined;
    // Sin el formato de Markdown que a veces añade (negritas en las palabras pedidas).
    const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\*+/g, '').trim() : '';
    const story = clean(parsed?.story);
    return story ? { title: clean(parsed?.title), story, translation: clean(parsed?.translation) } : null;
  }

  private async generateText(prompt: string, generationConfig?: object): Promise<string> {
    const params = new HttpParams().set('key', atob(environment.geminiApiKey));
    const contents = [{ parts: [{ text: prompt }] }];
    const response = await firstValueFrom(this.http.post<GeminiResponse>(
      environment.geminiTopicsUrl,
      generationConfig ? { contents, generationConfig } : { contents },
      { params }
    ).pipe(timeout(this.requestTimeoutMs)));

    return response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // "nivel B1 del MCER (Intermedio)": Gemini conoce los códigos del MCER; la etiqueta lo refuerza.
  private describeLevel(level: EnglishLevel): string {
    return `nivel ${level} del MCER (${englishLevelLabel(level)})`;
  }

  private parseTopics(text: string): string[] {
    return text
      .split(',')
      .map(topic => topic.replace(/^\s*\d+[.)-]\s*/, '').trim())
      .filter((topic, index, topics) => topic.length > 0 && topics.findIndex(item => toTopicKey(item) === toTopicKey(topic)) === index)
      .slice(0, 6);
  }

  private parseWords(text: string, count: number, excludedWords: Set<string>): WordSuggestion[] {
    const seenWords = new Set(excludedWords);
    const words: WordSuggestion[] = [];

    for (const item of this.parseJsonArray(text)) {
      const word = typeof item?.word === 'string' ? item.word.trim() : '';
      const translation = typeof item?.translation === 'string' ? item.translation.trim() : '';
      const example = typeof item?.example === 'string' ? item.example.trim() : '';
      const imageQuery = typeof item?.imageQuery === 'string' ? item.imageQuery.trim() : '';
      const key = word.toLowerCase();

      if (!word || !translation || seenWords.has(key)) continue;

      seenWords.add(key);
      words.push({ word, translation, example, imageQuery, confusables: this.parseConfusables(item?.confusables, word) });
      if (words.length === count) break;
    }

    return words;
  }

  // Como mucho 3, sin repetir y sin la propia palabra.
  private parseConfusables(value: unknown, word: string): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set([word.toLowerCase()]);
    const confusables: string[] = [];
    for (const item of value) {
      const confusable = typeof item === 'string' ? item.trim() : '';
      if (!confusable || seen.has(confusable.toLowerCase())) continue;
      seen.add(confusable.toLowerCase());
      confusables.push(confusable);
    }
    return confusables.slice(0, 3);
  }

  // [] si la respuesta no es un array JSON válido.
  private parseJsonArray(text: string): any[] {
    const parsed = this.parseJson(text);
    return Array.isArray(parsed) ? parsed : [];
  }

  // undefined si la respuesta no es JSON válido.
  private parseJson(text: string): unknown {
    const json = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();

    try {
      return JSON.parse(json);
    } catch {
      return undefined;
    }
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}
