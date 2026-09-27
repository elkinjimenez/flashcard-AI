import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import { toTopicKey } from './topic-key';
import { EnglishLevel, englishLevelLabel } from './english-level';

export interface WordSuggestion {
  word: string;
  translation: string;
  // Vacías si Gemini no las devolvió.
  example: string;
  imageQuery: string;
}

const exampleProperty = {
  type: 'STRING',
  description: 'Frase corta en inglés (máximo 12 palabras) que contenga la palabra exacta'
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
      }
    },
    required: ['word', 'translation', 'example', 'imageQuery']
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

const examplesResponseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING', description: 'La palabra tal como se pidió' },
      example: exampleProperty
    },
    required: ['word', 'example']
  }
};

@Injectable({ providedIn: 'root' })
export class GeminiService {
  constructor(private http: HttpClient) {}

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
      `Dame exactamente ${count} palabras de vocabulario en ingles de ${this.describeLevel(level)} sobre el tema "${topic}", cada una con su traduccion al español, una frase de ejemplo en inglés adecuada para ese nivel y una búsqueda para encontrar su GIF.`
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

  // Frases de ejemplo para palabras guardadas sin ella, indexadas por la palabra en minúsculas.
  async suggestExamples(words: string[], level: EnglishLevel): Promise<Map<string, string>> {
    const text = await this.generateText(
      `Escribe una frase de ejemplo en inglés, adecuada para un estudiante de ${this.describeLevel(level)}, para cada una de estas palabras: ${words.join(', ')}.`,
      { responseMimeType: 'application/json', responseSchema: examplesResponseSchema }
    );

    const examples = new Map<string, string>();
    for (const item of this.parseJsonArray(text)) {
      const word = typeof item?.word === 'string' ? item.word.trim().toLowerCase() : '';
      const example = typeof item?.example === 'string' ? item.example.trim() : '';
      if (word && example) examples.set(word, example);
    }
    return examples;
  }

  private async generateText(prompt: string, generationConfig?: object): Promise<string> {
    const params = new HttpParams().set('key', atob(environment.geminiApiKey));
    const contents = [{ parts: [{ text: prompt }] }];
    const response = await firstValueFrom(this.http.post<GeminiResponse>(
      environment.geminiTopicsUrl,
      generationConfig ? { contents, generationConfig } : { contents },
      { params }
    ));

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
      words.push({ word, translation, example, imageQuery });
      if (words.length === count) break;
    }

    return words;
  }

  // [] si la respuesta no es un array JSON válido.
  private parseJsonArray(text: string): any[] {
    const json = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();

    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
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
