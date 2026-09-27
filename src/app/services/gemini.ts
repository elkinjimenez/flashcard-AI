import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';
import { toTopicKey } from './topic-key';

export interface WordSuggestion {
  word: string;
  translation: string;
}

const wordsResponseSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      word: { type: 'STRING', description: 'Palabra en inglés' },
      translation: { type: 'STRING', description: 'Traducción al español' }
    },
    required: ['word', 'translation']
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
      `Dame 6 temas nuevos y cortos en español para aprender vocabulario de ingles. Cada tema debe tener como máximo 1 palabra, ser claro y no incluir descripciones, explicaciones ni frases largas.${excludedText} Responde únicamente con la lista separada por comas.`
    );
    return this.parseTopics(text);
  }

  // Devuelve como máximo `count` palabras válidas, sin repetir entre sí ni con `excludedWords` (en minúsculas).
  async suggestWords(topic: string, count: number, excludedWords: Set<string>): Promise<WordSuggestion[]> {
    const text = await this.generateText(
      `Dame exactamente ${count} palabras de vocabulario en ingles sobre el tema "${topic}", cada una con su traduccion al español.${excludedWords.size ? ` No incluyas estas palabras que ya tengo: ${[...excludedWords].join(', ')}.` : ''}`,
      { responseMimeType: 'application/json', responseSchema: wordsResponseSchema }
    );
    return this.parseWords(text, count, excludedWords);
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

  private parseTopics(text: string): string[] {
    return text
      .split(',')
      .map(topic => topic.replace(/^\s*\d+[.)-]\s*/, '').trim())
      .filter((topic, index, topics) => topic.length > 0 && topics.findIndex(item => toTopicKey(item) === toTopicKey(topic)) === index)
      .slice(0, 6);
  }

  private parseWords(text: string, count: number, excludedWords: Set<string>): WordSuggestion[] {
    const json = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
    let parsed: unknown;

    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) return [];

    const seenWords = new Set(excludedWords);
    const words: WordSuggestion[] = [];

    for (const item of parsed) {
      const word = typeof item?.word === 'string' ? item.word.trim() : '';
      const translation = typeof item?.translation === 'string' ? item.translation.trim() : '';
      const key = word.toLowerCase();

      if (!word || !translation || seenWords.has(key)) continue;

      seenWords.add(key);
      words.push({ word, translation });
      if (words.length === count) break;
    }

    return words;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}
