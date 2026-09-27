import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from 'src/environments/environment';
import { Flashcard } from './flashcard.model';

export interface ImageCandidate {
  // Klipy titula cada GIF con una descripción ("Whisking Egg Yolks in a Bowl"): sirve para elegir el más literal.
  title: string;
  url: string;
  // Miniatura (220 px): pesa la mitad que `url`, para mostrar muchos a la vez al elegir a mano.
  previewUrl: string;
}

@Injectable({ providedIn: 'root' })
export class KlipyService {
  private readonly requestConcurrency = 4;
  private readonly requestTimeoutMs = 5000;
  private readonly resultsPerSearch = 8;
  private readonly resultsPerManualSearch = 16;

  constructor(private http: HttpClient) {}

  // GIFs candidatos de cada tarjeta, en el mismo orden que `cards`.
  searchCandidates(cards: Flashcard[]): Promise<ImageCandidate[][]> {
    return this.mapWithConcurrency(cards, this.requestConcurrency, card => this.searchCardCandidates(card));
  }

  // Búsqueda escrita por el usuario al cambiar la imagen de una tarjeta. [] si no hay resultados o falla.
  searchImages(term: string): Promise<ImageCandidate[]> {
    return this.search(term, term, this.resultsPerManualSearch);
  }

  // Klipy busca por las palabras del título: la búsqueda visual de Gemini ("kitchen tongs") y la palabra sola dan
  // candidatos distintos, así que se juntan. Con la traducción solo si ninguna encuentra nada.
  private async searchCardCandidates({ word, translation, imageQuery }: Flashcard): Promise<ImageCandidate[]> {
    const terms = [...new Set([imageQuery?.trim(), word].filter((term): term is string => !!term))];
    const results = await Promise.all(terms.map(term => this.search(term, word)));
    let candidates = ([] as ImageCandidate[]).concat(...results);
    if (!candidates.length) {
      candidates = await this.search(`${word} ${translation}`, word);
    }

    const seenUrls = new Set<string>();
    return candidates.filter(candidate => {
      if (seenUrls.has(candidate.url)) return false;
      seenUrls.add(candidate.url);
      return true;
    });
  }

  private async search(term: string, word: string, perPage = this.resultsPerSearch): Promise<ImageCandidate[]> {
    const params = new HttpParams()
      .set('per_page', perPage)
      .set('content_filter', 'medium')
      .set('q', term)
      .set('fields', 'title,file.hd.webp,file.sm.webp');

    try {
      const response = await firstValueFrom(this.http.get<KlipyResponse>(
        environment.klipySearchUrl,
        { params }
      ).pipe(timeout(this.requestTimeoutMs)));

      return (response.data?.data ?? [])
        .map(item => {
          const url = this.findImageUrl(item.file) ?? '';
          return { title: item.title ?? '', url, previewUrl: this.findImageUrl(item.file?.sm) ?? url };
        })
        .filter(candidate => candidate.url);
    } catch (error) {
      console.warn(`No se pudo buscar la imagen de "${word}" (${term})`, error);
      return [];
    }
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

  private findImageUrl(value: unknown): string | undefined {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      return value;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const objectValue = value as Record<string, unknown>;
    for (const key of ['hd', 'webp', 'url', 'src']) {
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

// Solo los campos pedidos en `fields`.
interface KlipyResponse {
  data?: {
    data?: Array<{ title?: string; file?: { sm?: unknown } }>;
  };
}
