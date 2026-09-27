import { Injectable, inject } from '@angular/core';
import { Flashcard } from './flashcard.model';
import { GeminiService } from './gemini';
import { KlipyService } from './klipy';

// Imagen de cada tarjeta: Klipy da varios GIFs candidatos y Gemini elige, por su título, el que muestra la palabra
// de forma más literal (el primero de Klipy suele ser un meme de algún famoso o serie).
@Injectable({ providedIn: 'root' })
export class CardImageService {
  private klipy = inject(KlipyService);
  private gemini = inject(GeminiService);

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
}
