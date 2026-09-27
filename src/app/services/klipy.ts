import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Flashcard } from './flashcard.model';

@Injectable({ providedIn: 'root' })
export class KlipyService {
  private readonly requestConcurrency = 4;
  private readonly requestTimeoutMs = 5000;

  constructor(private http: HttpClient) {}

  // Si Klipy falla o no encuentra nada, conserva la imagen que ya tuviera la tarjeta.
  withImages(cards: Flashcard[]): Promise<Flashcard[]> {
    return this.mapWithConcurrency(cards, this.requestConcurrency, async card => ({
      ...card,
      imageUrl: (await this.searchImage(card.word, card.translation)) || card.imageUrl
    }));
  }

  // Vuelve a buscar la imagen de las tarjetas que quedaron sin ella.
  async retryMissingImages(cards: Flashcard[]): Promise<Flashcard[]> {
    const cardsWithoutImage = cards.filter(card => !card.imageUrl);
    if (!cardsWithoutImage.length) return cards;
    return this.fillImages(cards, await this.withImages(cardsWithoutImage));
  }

  // Solo completa las tarjetas sin imagen; no toca el resto de sus datos (p. ej. learned).
  fillImages(cards: Flashcard[], cardsWithImages: Flashcard[]): Flashcard[] {
    const imageUrls = new Map(cardsWithImages.map(card => [card.word, card.imageUrl]));
    return cards.map(card => card.imageUrl ? card : { ...card, imageUrl: imageUrls.get(card.word) ?? '' });
  }

  private async mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index]);
      }
    });

    await Promise.all(workers);
    return results;
  }

  private async searchImage(word: string, translation: string): Promise<string> {
    const searchTerms = [
      word,
      `${word} ${translation}`
    ];

    try {
      for (const searchTerm of searchTerms) {
        const params = new HttpParams()
          .set('per_page', '1')
          .set('content_filter', 'medium')
          .set('q', searchTerm)
          .set('fields', 'file.hd.webp');

        const response = await firstValueFrom(this.http.get<KlipyResponse>(
          environment.klipySearchUrl,
          { params }
        ).pipe(timeout(this.requestTimeoutMs)));
        const imageUrl = this.findImageUrl(response);

        if (imageUrl) {
          return imageUrl;
        }
      }
    } catch (error) {
      console.warn(`No se pudo obtener la imagen de "${word}"`, error);
    }

    return '';
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

interface KlipyResponse {
  [key: string]: unknown;
}
