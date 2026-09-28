import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpResponseBase } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { Flashcard } from './flashcard.model';
import { GeminiService } from './gemini';
import { KlipyService } from './klipy';

// Klipy no da error con un GIF borrado: sirve con 200 una imagen de relleno ("Content no longer available"), la misma
// para cada formato y de este tamaño. Solo las imágenes que lo miden se comprueban (ver isGone).
export const klipyPlaceholderSize = { width: 640, height: 360 };
// Respuestas que dicen que la imagen ya no está (si el servidor sí da error), no que falle un momento.
const goneStatuses = [403, 404, 410];
// Cabeceras que identifican el archivo servido; el resto cambia entre peticiones.
const fileHeaders = ['content-type', 'content-length', 'last-modified'];

// Imagen de cada tarjeta: Klipy da varios GIFs candidatos y Gemini elige, por su título, el que muestra la palabra
// de forma más literal (el primero de Klipy suele ser un meme de algún famoso o serie).
@Injectable({ providedIn: 'root' })
export class CardImageService {
  private klipy = inject(KlipyService);
  private gemini = inject(GeminiService);
  private http = inject(HttpClient);

  private readonly checkTimeoutMs = 5000;

  // Si Gemini falla o no le convence ninguno, se usa el primero de Klipy.
  // Sin candidatos, se apunta cuándo se buscó para no repetir la búsqueda enseguida (ver retryMissingImages).
  async withImages(cards: Flashcard[]): Promise<Flashcard[]> {
    if (!cards.length) return cards;

    const candidates = await this.klipy.searchCandidates(cards);
    const searched = cards
      .map((card, index) => ({ word: card.word, titles: candidates[index].map(candidate => candidate.title) }))
      .filter(item => item.titles.length);

    let picks = new Map<string, number>();
    if (searched.length) {
      try {
        picks = await this.gemini.pickImages(searched);
      } catch (error) {
        console.warn('Gemini no pudo elegir las imágenes; se usa el primer resultado de Klipy', error);
      }
    }

    const searchedAt = new Date().toISOString();
    return cards.map((card, index) => {
      const options = candidates[index];
      const chosen = options[picks.get(card.word.toLowerCase()) ?? -1] ?? options[0];
      return chosen ? { ...card, imageUrl: chosen.url } : { ...card, imageSearchedAt: searchedAt };
    });
  }

  // Vuelve a buscar la imagen de las tarjetas que quedaron sin ella, como mucho una vez al día por tarjeta:
  // si Klipy no encontró nada, repetirlo en cada sesión solo gastaría consultas.
  // Las tarjetas que no se buscan se devuelven tal cual (el mismo objeto).
  async retryMissingImages(cards: Flashcard[]): Promise<Flashcard[]> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const pending = cards.filter(card => !card.imageUrl && !(card.imageSearchedAt && card.imageSearchedAt > dayAgo));
    if (!pending.length) return cards;

    const searched = await this.withImages(pending);
    return cards.map(card => searched[pending.indexOf(card)] ?? card);
  }

  // Si una imagen ya no existe en su servidor: responde que no está o sirve la imagen de relleno de Klipy, que se reconoce
  // por ser el mismo archivo que da una dirección inventada con el mismo formato. false si no se sabe (sin conexión,
  // tarda u otro error).
  async isGone(url: string): Promise<boolean> {
    const image = await this.head(url);
    if (!image?.ok) return !!image && goneStatuses.includes(image.status);

    const { origin, pathname } = new URL(url);
    const placeholder = await this.head(`${origin}/flashcards-ai-missing${pathname.match(/\.\w+$/)?.[0] ?? ''}`);
    return !!placeholder?.ok && image.headers.has('content-length')
      && fileHeaders.every(name => image.headers.get(name) === placeholder.headers.get(name));
  }

  // Solo las cabeceras, sin descargar la imagen. null si no responde (sin conexión o tarda).
  private async head(url: string): Promise<HttpResponseBase | null> {
    try {
      return await firstValueFrom(
        this.http.head(url, { observe: 'response', responseType: 'text' }).pipe(timeout(this.checkTimeoutMs))
      );
    } catch (error) {
      return error instanceof HttpErrorResponse && error.status ? error : null;
    }
  }
}
