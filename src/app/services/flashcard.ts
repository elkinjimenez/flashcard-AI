import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';

export interface Flashcard {
  word: string;
  translation: string;
  imageUrl: string;
}

interface StoredStudySet {
  id: string;
  topic: string;
  cards: Flashcard[];
  createdAt: string;
  imageSearchVersion?: number;
}

export interface TopicResult {
  topics: string[];
  fromLocal: boolean;
}


@Injectable({ providedIn: 'root' })
export class FlashcardService {
  private readonly databaseName = 'flashcards-ai';
  private readonly storeName = 'study-sets';

  constructor(private http: HttpClient) {}

  async getTopics(): Promise<TopicResult> {
    const storedTopics = await this.readTopics();
    if (storedTopics.length) {
      return { topics: storedTopics, fromLocal: true };
    }

    return { topics: await this.requestTopics([]), fromLocal: false };
  }

  async getMoreTopics(displayedTopics: string[] = []): Promise<string[]> {
    const storedTopics = await this.readTopics();
    const excludedTopics = this.mergeTopics(storedTopics, displayedTopics);
    const newTopics = await this.requestTopics(excludedTopics);
    return newTopics.filter(topic => !this.hasTopic(excludedTopics, topic));
  }

  private async requestTopics(excludedTopics: string[]): Promise<string[]> {
    const params = new HttpParams().set('key', atob(environment.geminiApiKey));
    const excludedText = excludedTopics.length
      ? ` No incluyas estos temas ya guardados: ${excludedTopics.join(', ')}.`
      : '';
    const response = await firstValueFrom(this.http.post<GeminiResponse>(
      environment.geminiTopicsUrl,
      {
        contents: [{
          parts: [{
            text: `Dame 6 temas nuevos y cortos en español para aprender vocabulario de ingles. Cada tema debe tener como máximo 1 palabra, ser claro y no incluir descripciones, explicaciones ni frases largas.${excludedText} Responde únicamente con la lista separada por comas.`
          }]
        }]
      },
      { params }
    ));

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return this.parseTopics(text);
  }

  private parseTopics(text: string): string[] {
    return text
      .split(',')
      .map(topic => topic.replace(/^\s*\d+[.)-]\s*/, '').trim())
      .filter((topic, index, topics) => topic.length > 0 && topics.findIndex(item => item.toLocaleLowerCase() === topic.toLocaleLowerCase()) === index)
      .slice(0, 6);
  }

  private mergeTopics(existingTopics: string[], newTopics: string[]): string[] {
    return [...existingTopics, ...newTopics].filter((topic, index, topics) =>
      topics.findIndex(item => item.toLocaleLowerCase() === topic.toLocaleLowerCase()) === index
    );
  }

  private hasTopic(topics: string[], topic: string): boolean {
    return topics.some(item => item.toLocaleLowerCase() === topic.toLocaleLowerCase());
  }

  async generateFlashcards(topic: string, count: number): Promise<Flashcard[]> {
    const storedStudySet = await this.readStudySet(this.getStudySetId(topic, count));
    const storedCards = storedStudySet?.cards;
    if (storedCards?.length === count) {
      if (storedStudySet?.imageSearchVersion === 3) {
        return storedCards;
      }

      const migratedCards = await Promise.all(
        storedCards.map(async card => ({
          ...card,
          imageUrl: await this.getKlipyImageUrl(card.word, card.translation)
        }))
      );
      await this.saveStudySet(topic, migratedCards);
      return migratedCards;
    }

    const params = new HttpParams().set('key', atob(environment.geminiApiKey));
    const response = await firstValueFrom(this.http.post<GeminiResponse>(
      environment.geminiTopicsUrl,
      {
        contents: [{
          parts: [{
            text: `Dame exactamente ${count} palabras de vocabulario en ingles sobre el tema "${topic}". Responde unicamente con un JSON valido, sin markdown, usando este formato: [{"word":"English word","translation":"traduccion en espanol"}]`
          }]
        }]
      },
      { params }
    ));

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cards = this.parseFlashcards(text, count);

    if (cards.length !== count) {
      throw new Error('Gemini no devolvio la cantidad solicitada de palabras');
    }

    const cardsWithImages = await Promise.all(
      cards.map(async card => ({
        ...card,
        imageUrl: await this.getKlipyImageUrl(card.word, card.translation)
      }))
    );

    await this.saveStudySet(topic, cardsWithImages);
    return cardsWithImages;
  }

  async getStoredFlashcards(topic: string, count: number): Promise<Flashcard[] | null> {
    const record = await this.readStudySet(this.getStudySetId(topic, count));
    return record?.cards ?? null;
  }

  async deleteTopic(topic: string): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const studySets = request.result as StoredStudySet[];
        studySets
          .filter(studySet => studySet.topic === topic)
          .forEach(studySet => store.delete(studySet.id));
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  private parseFlashcards(text: string, count: number): Flashcard[] {
    const json = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim();
    let parsed: Array<{ word?: string; translation?: string }>;

    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }

    return parsed
      .map(card => ({
        word: card.word?.trim() ?? '',
        translation: card.translation?.trim() ?? '',
        imageUrl: ''
      }))
      .filter(card => card.word.length > 0 && card.translation.length > 0)
      .slice(0, count);
  }

  private async getKlipyImageUrl(word: string, translation: string): Promise<string> {
    const searchTerms = [
      word,
      `${word} ${translation}`
    ];

    for (const searchTerm of searchTerms) {
      const params = new HttpParams()
        .set('per_page', '1')
        .set('content_filter', 'low')
        .set('q', searchTerm)
        .set('fields', 'file.hd.webp');

      const response = await firstValueFrom(this.http.get<KlipyResponse>(
        environment.klipySearchUrl,
        { params }
      ));
      const imageUrl = this.findImageUrl(response);

      if (imageUrl) {
        return imageUrl;
      }
    }

    return '';
  }

  private async saveStudySet(topic: string, cards: Flashcard[]): Promise<void> {
    const database = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readwrite');
      transaction.objectStore(this.storeName).put({
        id: this.getStudySetId(topic, cards.length),
        topic,
        cards,
        createdAt: new Date().toISOString(),
        imageSearchVersion: 3
      } satisfies StoredStudySet);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }

  private async readStudySet(id: string): Promise<StoredStudySet | undefined> {
    const database = await this.openDatabase();
    const record = await new Promise<StoredStudySet | undefined>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).get(id);
      request.onsuccess = () => resolve(request.result as StoredStudySet | undefined);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return record;
  }

  private async readTopics(): Promise<string[]> {
    const database = await this.openDatabase();
    const topics = await new Promise<string[]>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).getAll();
      request.onsuccess = () => {
        const studySets = request.result as StoredStudySet[];
        resolve(this.mergeTopics([], studySets.map(studySet => studySet.topic)));
      };
      request.onerror = () => reject(request.error);
    });
    database.close();
    return topics;
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 3);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.storeName)) {
          database.createObjectStore(this.storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private getStudySetId(topic: string, count: number): string {
    return `${topic}:${count}`;
  }

  private findImageUrl(value: unknown): string | undefined {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      return value;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const objectValue = value as Record<string, unknown>;
    for (const key of ['file', 'hd', 'webp', 'url', 'src']) {
      if (key in objectValue) {
        const url = this.findImageUrl(objectValue[key]);
        if (url) return url;
      }
    }

    for (const child of Object.values(objectValue)) {
      const url = this.findImageUrl(child);
      if (url) return url;
    }

    return undefined;
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

interface KlipyResponse {
  [key: string]: unknown;
}
