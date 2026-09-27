import { Injectable } from '@angular/core';
import { Flashcard } from './flashcard.model';
import { GeminiService } from './gemini';
import { KlipyService } from './klipy';
import { StudySetRepository, currentImageSearchVersion } from './study-set-repository';
import { toTopicKey } from './topic-key';

export type { Flashcard } from './flashcard.model';

export interface TopicResult {
  topics: string[];
  fromLocal: boolean;
}

export interface TopicProgress {
  // Palabras acertadas en su último repaso o ya aprendidas.
  known: number;
  total: number;
}

// Días hasta el próximo repaso al subir a cada caja (1..5). Acertar en la última caja marca la palabra como aprendida.
const reviewIntervalDays = [1, 3, 7, 14, 30];

@Injectable({ providedIn: 'root' })
export class FlashcardService {
  constructor(
    private gemini: GeminiService,
    private klipy: KlipyService,
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

  async generateFlashcards(topic: string, count: number): Promise<Flashcard[]> {
    const storedStudySet = await this.studySets.get(topic);
    const storedCards = storedStudySet?.cards ?? [];
    const dueCards = this.getDueCards(storedCards);

    if (dueCards.length >= count) {
      if (storedStudySet?.imageSearchVersion === currentImageSearchVersion) {
        const sessionCards = dueCards.slice(0, count);
        const retriedCards = await this.klipy.retryMissingImages(sessionCards);
        if (retriedCards.some((card, index) => card.imageUrl !== sessionCards[index].imageUrl)) {
          await this.studySets.save(topic, this.klipy.fillImages(storedCards, retriedCards));
        }
        return retriedCards;
      }

      const migratedCards = await this.klipy.withImages(storedCards);
      await this.studySets.save(topic, migratedCards);
      return this.getDueCards(migratedCards).slice(0, count);
    }

    const existingWords = new Set(storedCards.map(card => card.word.toLowerCase()));
    const suggestions = await this.gemini.suggestWords(topic, count - dueCards.length, existingWords);
    const newCards: Flashcard[] = suggestions.map(suggestion => ({ ...suggestion, imageUrl: '' }));

    // Si Gemini devuelve menos palabras de las pedidas, la sesión simplemente es más corta.
    if (!newCards.length && !dueCards.length) {
      throw new Error('Gemini no devolvio palabras validas');
    }

    const retriedDueCards = await this.klipy.retryMissingImages(dueCards);
    const newCardsWithImages = await this.klipy.withImages(newCards);

    const allCards = [...this.klipy.fillImages(storedCards, retriedDueCards), ...newCardsWithImages];
    await this.studySets.save(topic, allCards);
    return [...retriedDueCards, ...newCardsWithImages];
  }

  // null: el tema no está guardado. []: no hay repasos pendientes ni palabras nuevas por estudiar.
  async getStoredFlashcards(topic: string, count: number): Promise<Flashcard[] | null> {
    const record = await this.studySets.get(topic);
    if (!record) return null;
    return this.getDueCards(record.cards).slice(0, count);
  }

  async recordAnswer(topic: string, word: string, knew: boolean): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === word ? this.applyAnswer(card, knew) : card
    ));
  }

  // Mantiene las palabras e imágenes, pero todas vuelven a ser nuevas.
  async resetTopic(topic: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(({ word, translation, imageUrl }) =>
      ({ word, translation, imageUrl })
    ));
  }

  // Indexado por la clave del tema (toTopicKey).
  async getTopicsProgress(): Promise<Map<string, TopicProgress>> {
    const studySets = await this.studySets.getAll();
    return new Map(studySets.map(studySet => [toTopicKey(studySet.topic), {
      known: studySet.cards.filter(card => card.learned || (card.box ?? 0) >= 1).length,
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
