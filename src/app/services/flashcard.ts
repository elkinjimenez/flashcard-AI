import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { Flashcard, learnedBox, reviewIntervalDays } from './flashcard.model';
import { GeminiService } from './gemini';
import { CardImageService } from './card-images';
import { StudySetRepository } from './study-set-repository';
import { toTopicKey } from './topic-key';
import { EnglishLevel } from './english-level';
import { toDayKey } from './day-key';

export type { Flashcard } from './flashcard.model';

export interface TopicResult {
  topics: string[];
  fromLocal: boolean;
}

export interface TopicProgress {
  // Palabras acertadas en su último repaso o ya aprendidas.
  known: number;
  // Las que se pueden practicar sin pedir nuevas: las aún sin aprender y las aprendidas a las que les toca repaso.
  pending: number;
  total: number;
}

// Una respuesta guardada, con lo necesario para deshacerla (ver undoAnswer).
export interface AnswerRecord {
  // La tarjeta tal como estaba antes de responder.
  previous: Flashcard;
  knew: boolean;
  // Día en que se contó en la actividad: si se deshace pasada la medianoche, se descuenta de ese. undefined si no se
  // contó ("Ya la conozco", ver markKnown).
  day?: string;
}

// "Ya la conozco" al presentarla: la primera caja en la que hay que producirla (escribirla o decirla sin pistas). Si de
// verdad la sabe, en dos repasos más queda aprendida; si no, el primer fallo la devuelve a la caja 0.
const knownBox = 4;

@Injectable({ providedIn: 'root' })
export class FlashcardService {
  private gemini = inject(GeminiService);
  private images = inject(CardImageService);
  private studySets = inject(StudySetRepository);

  // Emite al salir de una sesión de práctica, con sus respuestas ya guardadas: las pestañas refrescan su progreso.
  // Ionic no les manda ionViewWillEnter al volver de la práctica, solo a la página de pestañas que las contiene.
  readonly sessionEnded = new Subject<void>();

  async getTopics(): Promise<TopicResult> {
    const storedTopics = await this.readTopics();
    if (storedTopics.length) {
      return { topics: storedTopics, fromLocal: true };
    }

    return { topics: await this.gemini.suggestTopics([]), fromLocal: false };
  }

  async getMoreTopics(displayedTopics: string[] = []): Promise<string[]> {
    const storedTopics = await this.readTopics();
    const excludedTopics = this.mergeTopics(storedTopics, displayedTopics);
    const newTopics = await this.gemini.suggestTopics(excludedTopics);
    return newTopics.filter(topic => !this.hasTopic(excludedTopics, topic));
  }

  // Sesión de un tema. Si está guardado se arma solo con sus palabras: ni se piden nuevas a Gemini ni se vuelven a
  // buscar sus imágenes. Un tema nuevo se crea con palabras nuevas.
  // []: el tema está guardado y ya se saben todas sus palabras.
  async prepareSession(topic: string, count: number, level: EnglishLevel): Promise<Flashcard[]> {
    const stored = await this.studySets.get(topic);
    if (!stored?.cards.length) {
      return this.addWords(topic, count, level);
    }
    return this.completeCards(topic, this.pickSessionCards(stored.cards, count), level);
  }

  // Palabras nuevas para el tema, con sus imágenes: lo único que pide palabras a Gemini y busca GIFs en Klipy.
  // El nivel solo afecta a las nuevas; las ya guardadas se mantienen.
  async addWords(topic: string, count: number, level: EnglishLevel): Promise<Flashcard[]> {
    const stored = await this.studySets.get(topic);
    const existingWords = new Set((stored?.cards ?? []).map(card => card.word.toLowerCase()));
    const suggestions = await this.gemini.suggestWords(topic, count, existingWords, level);

    // Si Gemini devuelve menos palabras de las pedidas, la sesión simplemente es más corta.
    if (!suggestions.length) {
      throw new Error('Gemini no devolvio palabras validas');
    }

    const newCards = await this.images.withImages(suggestions.map(suggestion => ({ ...suggestion, imageUrl: '' })));
    if (stored) {
      await this.studySets.updateCards(topic, cards => [...cards, ...newCards]);
    } else {
      await this.studySets.save(topic, newCards);
    }
    return newCards;
  }

  // Primero lo que toca hoy; si no llega a `count`, se adelantan los próximos repasos (acertarlos no mueve su
  // calendario, ver applyAnswer). Las aprendidas vuelven solo cuando les toca su repaso de mantenimiento: no se adelantan.
  private pickSessionCards(cards: Flashcard[], count: number): Flashcard[] {
    const now = new Date().toISOString();
    const upcoming = cards
      .filter(card => !card.learned && card.nextReview && card.nextReview > now)
      .sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));
    return [...this.getDueCards(cards), ...upcoming].slice(0, count);
  }

  // Completa lo que les falte a las tarjetas de la sesión (imagen, frase de ejemplo o confundibles) y lo guarda, para no
  // volver a pedirlo.
  private async completeCards(topic: string, cards: Flashcard[], level: EnglishLevel): Promise<Flashcard[]> {
    const completed = await this.fillMissingDetails(await this.images.retryMissingImages(cards), level);
    const changes = new Map(completed.filter((card, index) => card !== cards[index]).map(card => [card.word, card]));
    if (changes.size) {
      // Solo lo buscado: el progreso es el que esté guardado.
      await this.studySets.updateCards(topic, storedCards => storedCards.map(card => {
        const change = changes.get(card.word);
        return change
          ? {
            ...card,
            imageUrl: change.imageUrl,
            imageSearchedAt: change.imageSearchedAt,
            example: change.example,
            confusables: change.confusables
          }
          : card;
      }));
    }
    return completed;
  }

  // Pide a Gemini, en una sola consulta, lo que les falte a las palabras guardadas antes de existir: frase de ejemplo
  // y confundibles. Lo que no devuelva queda vacío para no volver a pedirlo; si la consulta falla, la sesión sigue sin
  // ello y se reintenta en la próxima.
  private async fillMissingDetails(cards: Flashcard[], level: EnglishLevel): Promise<Flashcard[]> {
    const isIncomplete = (card: Flashcard) => card.example === undefined || card.confusables === undefined;
    const words = cards.filter(isIncomplete).map(card => card.word);
    if (!words.length) return cards;

    try {
      const details = await this.gemini.suggestDetails(words, level);
      if (!details.size) return cards;

      return cards.map(card => {
        if (!isIncomplete(card)) return card;
        const found = details.get(card.word.toLowerCase());
        // Lo que ya tenía se queda: Gemini devuelve las dos cosas aunque solo faltara una.
        return { ...card, example: card.example ?? found?.example ?? '', confusables: card.confusables ?? found?.confusables ?? [] };
      });
    } catch (error) {
      console.warn('No se pudieron completar las frases de ejemplo ni las confundibles', error);
      return cards;
    }
  }

  // Todas las palabras del tema, también las aprendidas: sirven de opciones en los ejercicios.
  async getTopicCards(topic: string): Promise<Flashcard[]> {
    return (await this.studySets.get(topic))?.cards ?? [];
  }

  // Guarda la respuesta en la tarjeta y la cuenta en la actividad del día. undefined si la tarjeta ya no existe.
  async recordAnswer(topic: string, word: string, knew: boolean): Promise<AnswerRecord | undefined> {
    const previous = await this.updateCard(topic, word, card => this.applyAnswer(card, knew));
    if (!previous) return undefined;

    const day = toDayKey(new Date());
    await this.countActivity(day, knew, 1);
    return { previous, knew, day };
  }

  // Una palabra nueva que ya conocía salta a la caja knownBox, con el repaso que le toca en ella. No es una respuesta:
  // no cuenta en la actividad. Se deshace con undoAnswer; undefined si la tarjeta ya no existe.
  async markKnown(topic: string, word: string): Promise<AnswerRecord | undefined> {
    const previous = await this.updateCard(topic, word, card =>
      ({ ...card, box: knownBox, nextReview: this.reviewDate(knownBox) }));
    return previous && { previous, knew: true };
  }

  // Solo el progreso: lo demás (p. ej. una imagen cambiada después de responder) se queda como está.
  async undoAnswer(topic: string, { previous, knew, day }: AnswerRecord): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === previous.word
        ? { ...card, learned: previous.learned, box: previous.box, nextReview: previous.nextReview, misses: previous.misses }
        : card
    ));
    if (day) {
      await this.countActivity(day, knew, -1);
    }
  }

  // La tarjeta tal como estaba antes de cambiarla; undefined si ya no existe.
  private async updateCard(topic: string, word: string, update: (card: Flashcard) => Flashcard): Promise<Flashcard | undefined> {
    let previous: Flashcard | undefined;
    await this.studySets.updateCards(topic, cards => cards.map(card => {
      if (card.word !== word) return card;
      previous = card;
      return update(card);
    }));
    return previous;
  }

  // Truco para recordar una palabra que cuesta: el guardado o, la primera vez, uno nuevo de la IA, que se guarda (también
  // si no da ninguno, para no volver a pedirlo). No toca el progreso.
  async getMnemonic(topic: string, card: Pick<Flashcard, 'word' | 'translation' | 'mnemonic'>): Promise<string> {
    if (card.mnemonic !== undefined) return card.mnemonic;

    const mnemonic = await this.gemini.suggestMnemonic(card.word, card.translation);
    await this.updateCard(topic, card.word, stored => ({ ...stored, mnemonic }));
    return mnemonic;
  }

  // Imagen elegida a mano cuando la de la IA no muestra bien la palabra. No toca el progreso.
  async changeImage(topic: string, word: string, imageUrl: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === word ? { ...card, imageUrl } : card
    ));
  }

  // Mantiene las palabras, imágenes, ejemplos, confundibles, trucos y búsquedas, pero todas vuelven a ser nuevas.
  async resetTopic(topic: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(
      ({ word, translation, imageUrl, example, confusables, mnemonic, imageQuery }) =>
        ({ word, translation, imageUrl, example, confusables, mnemonic, imageQuery })
    ));
  }

  // Indexado por la clave del tema (toTopicKey).
  async getTopicsProgress(): Promise<Map<string, TopicProgress>> {
    const studySets = await this.studySets.getAll();
    const now = new Date().toISOString();
    return new Map(studySets.map(studySet => [toTopicKey(studySet.topic), {
      known: studySet.cards.filter(card => card.learned || (card.box ?? 0) >= 1).length,
      pending: studySet.cards.filter(card => !card.learned || this.isDue(card, now)).length,
      total: studySet.cards.length
    }]));
  }

  async deleteTopic(topic: string): Promise<void> {
    await this.studySets.delete(topic);
  }

  // Leitner: acertar sube una caja y aleja el próximo repaso; fallar la devuelve a la caja 0 para repasarla ya, aunque
  // estuviera aprendida.
  private applyAnswer(card: Flashcard, knew: boolean): Flashcard {
    const now = new Date();
    if (!knew) {
      return { ...card, learned: false, box: 0, nextReview: now.toISOString(), misses: (card.misses ?? 0) + 1 };
    }

    // Acertar una tarjeta que aún no tocaba (p. ej. al repasar las difíciles) no adelanta su calendario.
    if (card.nextReview && card.nextReview > now.toISOString()) {
      return card;
    }

    // En la última caja se queda: sus repasos siguen con el mismo intervalo.
    const box = Math.min((card.box ?? 0) + 1, reviewIntervalDays.length);
    return { ...card, box, learned: box >= learnedBox, nextReview: this.reviewDate(box) };
  }

  // Próximo repaso al llegar a una caja: desde el comienzo de hoy, para que toque a primera hora de ese día.
  private reviewDate(box: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + reviewIntervalDays[box - 1]);
    return date.toISOString();
  }

  // Tarjetas que tocan hoy: primero los repasos, también los de mantenimiento de las aprendidas (los más atrasados
  // antes), y luego las palabras nuevas.
  private getDueCards(cards: Flashcard[]): Flashcard[] {
    const now = new Date().toISOString();
    const reviews = cards
      .filter(card => this.isDue(card, now))
      .sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));
    return [...reviews, ...cards.filter(card => !card.learned && !card.nextReview)];
  }

  // Ya le toca repaso, aprendida o no. Las nuevas no tienen fecha: no cuentan.
  private isDue(card: Flashcard, now: string): boolean {
    return !!card.nextReview && card.nextReview <= now;
  }

  // La actividad es solo para las estadísticas: si no se guarda, la respuesta sí vale.
  private async countActivity(day: string, knew: boolean, sign: 1 | -1) {
    try {
      await this.studySets.addActivity(day, sign, knew ? sign : 0);
    } catch (error) {
      console.warn('No se pudo guardar la actividad del día', error);
    }
  }

  private async readTopics(): Promise<string[]> {
    const studySets = await this.studySets.getAll();
    return this.mergeTopics([], studySets.map(studySet => studySet.topic));
  }

  private mergeTopics(existingTopics: string[], newTopics: string[]): string[] {
    return [...existingTopics, ...newTopics].filter((topic, index, topics) =>
      topics.findIndex(item => toTopicKey(item) === toTopicKey(topic)) === index
    );
  }

  private hasTopic(topics: string[], topic: string): boolean {
    return topics.some(item => toTopicKey(item) === toTopicKey(topic));
  }
}
