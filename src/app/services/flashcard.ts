import { Injectable } from '@angular/core';
import { Flashcard } from './flashcard.model';
import { GeminiService } from './gemini';
import { CardImageService } from './card-images';
import { StudySetRepository } from './study-set-repository';
import { toTopicKey } from './topic-key';
import { EnglishLevel } from './english-level';

export type { Flashcard } from './flashcard.model';

export interface TopicResult {
  topics: string[];
  fromLocal: boolean;
}

export interface TopicProgress {
  // Palabras acertadas en su último repaso o ya aprendidas.
  known: number;
  // Palabras aún sin aprender: las que se pueden practicar sin pedir nuevas.
  pending: number;
  total: number;
}

// Días hasta el próximo repaso al subir a cada caja (1..5). Acertar en la última caja marca la palabra como aprendida.
const reviewIntervalDays = [1, 3, 7, 14, 30];

@Injectable({ providedIn: 'root' })
export class FlashcardService {
  constructor(
    private gemini: GeminiService,
    private images: CardImageService,
    private studySets: StudySetRepository
  ) {}

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
  // calendario, ver applyAnswer). Las aprendidas no vuelven.
  private pickSessionCards(cards: Flashcard[], count: number): Flashcard[] {
    const now = new Date().toISOString();
    const upcoming = cards
      .filter(card => !card.learned && card.nextReview && card.nextReview > now)
      .sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));
    return [...this.getDueCards(cards), ...upcoming].slice(0, count);
  }

  // Completa lo que les falte a las tarjetas de la sesión (imagen o frase de ejemplo) y lo guarda, para no volver a pedirlo.
  private async completeCards(topic: string, cards: Flashcard[], level: EnglishLevel): Promise<Flashcard[]> {
    const completed = await this.fillMissingExamples(await this.images.retryMissingImages(cards), level);
    const changes = new Map(completed.filter((card, index) => card !== cards[index]).map(card => [card.word, card]));
    if (changes.size) {
      // Solo lo buscado: el progreso es el que esté guardado.
      await this.studySets.updateCards(topic, storedCards => storedCards.map(card => {
        const change = changes.get(card.word);
        return change
          ? { ...card, imageUrl: change.imageUrl, imageSearchedAt: change.imageSearchedAt, example: change.example }
          : card;
      }));
    }
    return completed;
  }

  // Pide a Gemini las frases de ejemplo que falten (temas guardados antes de existir). Las que no devuelva quedan vacías
  // para no volver a pedirlas; si la consulta falla, la sesión sigue sin ellas y se reintenta en la próxima.
  private async fillMissingExamples(cards: Flashcard[], level: EnglishLevel): Promise<Flashcard[]> {
    const words = cards.filter(card => card.example === undefined).map(card => card.word);
    if (!words.length) return cards;

    try {
      const examples = await this.gemini.suggestExamples(words, level);
      if (!examples.size) return cards;

      return cards.map(card => card.example === undefined
        ? { ...card, example: examples.get(card.word.toLowerCase()) ?? '' }
        : card);
    } catch (error) {
      console.warn('No se pudieron completar las frases de ejemplo', error);
      return cards;
    }
  }

  // Todas las palabras del tema, también las aprendidas: sirven de opciones en los ejercicios.
  async getTopicCards(topic: string): Promise<Flashcard[]> {
    return (await this.studySets.get(topic))?.cards ?? [];
  }

  // Devuelve la tarjeta tal como estaba antes de responder, para poder deshacer con restoreCard.
  async recordAnswer(topic: string, word: string, knew: boolean): Promise<Flashcard | undefined> {
    let previous: Flashcard | undefined;
    await this.studySets.updateCards(topic, cards => cards.map(card => {
      if (card.word !== word) return card;
      previous = card;
      return this.applyAnswer(card, knew);
    }));
    return previous;
  }

  // Solo el progreso: lo demás (p. ej. una imagen cambiada después de responder) se queda como está.
  async restoreCard(topic: string, previous: Flashcard): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === previous.word
        ? { ...card, learned: previous.learned, box: previous.box, nextReview: previous.nextReview }
        : card
    ));
  }

  // Imagen elegida a mano cuando la de la IA no muestra bien la palabra. No toca el progreso.
  async changeImage(topic: string, word: string, imageUrl: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === word ? { ...card, imageUrl } : card
    ));
  }

  // Mantiene las palabras, imágenes, ejemplos y búsquedas, pero todas vuelven a ser nuevas.
  async resetTopic(topic: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(({ word, translation, imageUrl, example, imageQuery }) =>
      ({ word, translation, imageUrl, example, imageQuery })
    ));
  }

  // Indexado por la clave del tema (toTopicKey).
  async getTopicsProgress(): Promise<Map<string, TopicProgress>> {
    const studySets = await this.studySets.getAll();
    return new Map(studySets.map(studySet => [toTopicKey(studySet.topic), {
      known: studySet.cards.filter(card => card.learned || (card.box ?? 0) >= 1).length,
      pending: studySet.cards.filter(card => !card.learned).length,
      total: studySet.cards.length
    }]));
  }

  async deleteTopic(topic: string): Promise<void> {
    await this.studySets.delete(topic);
  }

  // Leitner: acertar sube una caja y aleja el próximo repaso; fallar la devuelve a la caja 0 para repasarla ya.
  private applyAnswer(card: Flashcard, knew: boolean): Flashcard {
    const now = new Date();
    if (!knew) {
      return { ...card, box: 0, nextReview: now.toISOString() };
    }

    // Acertar una tarjeta que aún no tocaba (p. ej. al repasar las difíciles) no adelanta su calendario.
    if (card.nextReview && card.nextReview > now.toISOString()) {
      return card;
    }

    const box = card.box ?? 0;
    if (box >= reviewIntervalDays.length) {
      return { ...card, learned: true };
    }

    const nextReview = new Date(now);
    nextReview.setHours(0, 0, 0, 0);
    nextReview.setDate(nextReview.getDate() + reviewIntervalDays[box]);
    return { ...card, box: box + 1, nextReview: nextReview.toISOString() };
  }

  // Tarjetas que tocan hoy: primero los repasos (los más atrasados antes) y luego las palabras nuevas.
  private getDueCards(cards: Flashcard[]): Flashcard[] {
    const now = new Date().toISOString();
    const dueCards = cards.filter(card => !card.learned && (!card.nextReview || card.nextReview <= now));
    const reviews = dueCards
      .filter(card => card.nextReview)
      .sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));
    return [...reviews, ...dueCards.filter(card => !card.nextReview)];
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
