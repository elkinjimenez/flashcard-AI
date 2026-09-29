import { Injectable, inject } from '@angular/core';
import { Subject } from 'rxjs';
import {
  Flashcard, boxAfterLapse, isKnownCard, isNewCard, knownStepsPercent, learnedBox, reviewIntervalDays
} from './flashcard.model';
import { GeminiService } from './gemini';
import { CardImageService } from './card-images';
import { StoredStudySet, StudySetRepository } from './study-set-repository';
import { toTopicKey } from './topic-key';
import { EnglishLevel } from './english-level';
import { toDayKey } from './day-key';
import { loadNewWordsLimit } from './new-words-limit';

export type { Flashcard } from './flashcard.model';

export interface TopicResult {
  topics: string[];
  fromLocal: boolean;
}

export interface TopicProgress {
  // Afianzadas o aprendidas (ver isKnownCard).
  known: number;
  // Empezadas, aún sin saberlas.
  learning: number;
  // Las que se pueden practicar sin pedir nuevas: las aún sin aprender y las aprendidas a las que les toca repaso.
  pending: number;
  // Las nuevas aún sin empezar (también cuentan en pending).
  newWords: number;
  total: number;
  // Avance hacia sabérselas todas (0..100, ver knownStepsPercent): se mueve en cada repaso, no solo al saberse una.
  percent: number;
}

// Palabras nuevas empezadas hoy y cuántas quedan hasta el tope de Ajustes (ver newWordsLimits).
export interface NewWordsToday {
  started: number;
  limit: number;
  left: number;
}

// Ya se empezaron hoy todas las palabras nuevas del tope. Su mensaje se puede mostrar tal cual.
export class NewWordsLimitError extends Error {
  constructor(limit: number) {
    super(`Hoy ya empezaste ${limit} palabras nuevas, tu tope diario. Repasa las que tienes o vuelve mañana; el tope `
      + 'se cambia en Ajustes.');
  }
}

// Una respuesta guardada, con lo necesario para deshacerla (ver undoAnswer).
export interface AnswerRecord {
  // La tarjeta tal como estaba antes de responder.
  previous: Flashcard;
  // Y como quedó: el resumen de la sesión las compara para ver si subió de nivel y cuándo vuelve.
  current: Flashcard;
  knew: boolean;
  // Día en que se contó en la actividad: si se deshace pasada la medianoche, se descuenta de ese. undefined si no se
  // contó ("Ya la conozco", ver markKnown).
  day?: string;
}

// Sesión con palabras de varios temas (ver prepareMixedReview y prepareWords): sus tarjetas y el tema de cada una, por
// palabra.
export interface MixedReview {
  cards: Flashcard[];
  cardTopics: Record<string, string>;
}

// Una palabra borrada de la lista del tema, con lo necesario para devolverla a su sitio (ver restoreWord).
export interface DeletedWord {
  card: Flashcard;
  index: number;
}

// "Ya la conozco" al presentarla: la primera caja en la que hay que producirla (escribirla o decirla sin pistas). Si de
// verdad la sabe, en dos repasos más queda aprendida; si no, el primer fallo la baja de caja como a cualquiera.
const knownBox = 4;

// Mantiene la palabra, su imagen, ejemplo, confundibles, truco y búsqueda, pero vuelve a ser nueva.
function resetCard({ word, translation, imageUrl, example, confusables, mnemonic, imageQuery }: Flashcard): Flashcard {
  return { word, translation, imageUrl, example, confusables, mnemonic, imageQuery };
}

@Injectable({ providedIn: 'root' })
export class FlashcardService {
  private gemini = inject(GeminiService);
  private images = inject(CardImageService);
  private studySets = inject(StudySetRepository);

  // Emite al salir de una sesión de práctica (con sus respuestas ya guardadas) y al cambiar una palabra desde la lista
  // del tema: las pestañas refrescan su progreso. Ionic no les manda ionViewWillEnter al volver de esas páginas, solo a
  // la página de pestañas que las contiene.
  readonly cardsChanged = new Subject<void>();
  // Emite la URL de una imagen que ya no existe, cuando ya se quitó de sus tarjetas (ver dropMissingImage).
  readonly imageDropped = new Subject<string>();
  // Imágenes ya comprobadas mientras la app sigue abierta: cada una una sola vez, aunque salga en varias pantallas.
  private checkedImages = new Set<string>();

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
  // buscar sus imágenes. Un tema nuevo se crea con palabras nuevas. Las nuevas, como mucho las que queden del tope diario.
  // []: el tema está guardado y ya se saben todas sus palabras, o solo le quedan nuevas y ya se llegó al tope.
  async prepareSession(topic: string, count: number, level: EnglishLevel): Promise<Flashcard[]> {
    const stored = await this.studySets.get(topic);
    if (!stored?.cards.length) {
      return this.addWords(topic, count, level);
    }
    const { left } = await this.newWordsToday();
    return this.completeCards(topic, this.pickSessionCards(stored.cards, count, left), level);
  }

  // Una palabra nueva se empieza con su primera respuesta: desde ahí vuelve al día siguiente, a los 3 días y a los 7.
  async newWordsToday(): Promise<NewWordsToday> {
    const today = toDayKey(new Date());
    const started = (await this.studySets.getActivity()).find(day => day.date === today)?.newWords ?? 0;
    const limit = loadNewWordsLimit();
    return { started, limit, left: Math.max(0, limit - started) };
  }

  // Los repasos que tocan en todos los temas, para practicarlos mezclados; si son más de `count`, los más atrasados.
  // Solo repasos: ni palabras nuevas ni adelantadas. Una palabra que está en varios temas sale una vez: en la sesión,
  // la palabra identifica la tarjeta.
  async prepareMixedReview(count: number, level: EnglishLevel): Promise<MixedReview> {
    const now = new Date().toISOString();
    const due = ([] as { topic: string; card: Flashcard }[])
      .concat(...(await this.studySets.getAll()).map(({ topic, cards }) =>
        cards.filter(card => this.isDue(card, now)).map(card => ({ topic, card }))))
      .sort((a, b) => (a.card.nextReview ?? '').localeCompare(b.card.nextReview ?? ''));
    return this.prepareMixedSession(due, count, level);
  }

  // Unas palabras concretas de uno o varios temas, para practicarlas juntas (las que más cuestan, desde Progreso). Las
  // que ya no existan se omiten.
  async prepareWords(words: { topic: string; word: string }[], level: EnglishLevel): Promise<MixedReview> {
    const studySets = await this.studySets.getAll();
    const items = words
      .map(({ topic, word }) => ({
        topic,
        card: studySets.find(studySet => studySet.topic === topic)?.cards.find(card => card.word === word)
      }))
      .filter((item): item is { topic: string; card: Flashcard } => !!item.card);
    return this.prepareMixedSession(items, words.length, level);
  }

  // Las primeras `count` palabras distintas, cada una con su tema.
  private async prepareMixedSession(
    items: { topic: string; card: Flashcard }[],
    count: number,
    level: EnglishLevel
  ): Promise<MixedReview> {
    const picked = new Map<string, { topic: string; card: Flashcard }>();
    for (const item of items) {
      if (picked.size === count) break;
      if (!picked.has(item.card.word)) picked.set(item.card.word, item);
    }

    // Lo que les falte se completa y se guarda en su tema.
    const cardsByTopic = new Map<string, Flashcard[]>();
    for (const { topic, card } of picked.values()) {
      cardsByTopic.set(topic, [...cardsByTopic.get(topic) ?? [], card]);
    }
    const cards: Flashcard[] = [];
    const cardTopics: Record<string, string> = {};
    for (const [topic, topicCards] of cardsByTopic) {
      cards.push(...await this.completeCards(topic, topicCards, level));
      topicCards.forEach(card => cardTopics[card.word] = topic);
    }
    return { cards, cardTopics };
  }

  // Palabras nuevas para el tema, con sus imágenes: lo único que pide palabras a Gemini y busca GIFs en Klipy.
  // El nivel solo afecta a las nuevas; las ya guardadas se mantienen. Como mucho, las que queden del tope diario: sin
  // ninguna, NewWordsLimitError.
  async addWords(topic: string, count: number, level: EnglishLevel): Promise<Flashcard[]> {
    const { limit, left } = await this.newWordsToday();
    if (!left) throw new NewWordsLimitError(limit);

    const stored = await this.studySets.get(topic);
    const existingWords = new Set((stored?.cards ?? []).map(card => card.word.toLowerCase()));
    const suggestions = await this.gemini.suggestWords(topic, Math.min(count, left), existingWords, level);

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
  private pickSessionCards(cards: Flashcard[], count: number, newLimit: number): Flashcard[] {
    const now = new Date().toISOString();
    const upcoming = cards
      .filter(card => !card.learned && card.nextReview && card.nextReview > now)
      .sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));
    return [...this.getDueCards(cards, newLimit), ...upcoming].slice(0, count);
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

  // El tema guardado, buscado por su nombre o por su clave (toTopicKey); undefined si no existe.
  getStudySet(topic: string): Promise<StoredStudySet | undefined> {
    return this.studySets.get(topic);
  }

  // Corrige la traducción. El truco para recordarla se basaba en la anterior: se descarta y la IA creará otro cuando
  // haga falta. No toca el progreso.
  async editTranslation(topic: string, word: string, translation: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === word ? { ...card, translation, mnemonic: undefined } : card
    ));
  }

  // "Ya me la sé", desde la lista del tema: pasa a aprendida, con su primer repaso de mantenimiento. No cuenta en la
  // actividad. Se deshace con undoAnswer; undefined si la tarjeta ya no existe.
  async markLearned(topic: string, word: string): Promise<AnswerRecord | undefined> {
    const change = await this.updateCard(topic, word, card =>
      ({ ...card, learned: true, box: learnedBox, nextReview: this.reviewDate(learnedBox) }));
    return change && { ...change, knew: true };
  }

  // Quita la palabra del tema, con su progreso. undefined si ya no existía.
  async deleteWord(topic: string, word: string): Promise<DeletedWord | undefined> {
    let deleted: DeletedWord | undefined;
    await this.studySets.updateCards(topic, cards => {
      const index = cards.findIndex(card => card.word === word);
      if (index < 0) return cards;
      deleted = { card: cards[index], index };
      return cards.filter((_, i) => i !== index);
    });
    return deleted;
  }

  // Deshace deleteWord: la tarjeta vuelve a su sitio tal como estaba. Si entretanto se volvió a añadir, no se duplica.
  async restoreWord(topic: string, { card, index }: DeletedWord): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.some(item => item.word === card.word)
      ? cards
      : [...cards.slice(0, index), card, ...cards.slice(index)]);
  }

  // Guarda la respuesta en la tarjeta y la cuenta en la actividad del día (si era nueva, también en el tope diario).
  // undefined si la tarjeta ya no existe.
  async recordAnswer(topic: string, word: string, knew: boolean): Promise<AnswerRecord | undefined> {
    const change = await this.updateCard(topic, word, card => this.applyAnswer(card, knew));
    if (!change) return undefined;

    const day = toDayKey(new Date());
    await this.countActivity(day, knew, isNewCard(change.previous), 1);
    return { ...change, knew, day };
  }

  // Una palabra nueva que ya conocía salta a la caja knownBox, con el repaso que le toca en ella. No es una respuesta:
  // no cuenta en la actividad ni en el tope diario (su primer repaso es en semanas). Se deshace con undoAnswer;
  // undefined si la tarjeta ya no existe.
  async markKnown(topic: string, word: string): Promise<AnswerRecord | undefined> {
    const change = await this.updateCard(topic, word, card =>
      ({ ...card, box: knownBox, nextReview: this.reviewDate(knownBox) }));
    return change && { ...change, knew: true };
  }

  // Solo el progreso: lo demás (p. ej. una imagen cambiada después de responder) se queda como está.
  async undoAnswer(topic: string, { previous, knew, day }: AnswerRecord): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(card =>
      card.word === previous.word
        ? { ...card, learned: previous.learned, box: previous.box, nextReview: previous.nextReview, misses: previous.misses }
        : card
    ));
    if (day) {
      await this.countActivity(day, knew, isNewCard(previous), -1);
    }
  }

  // La tarjeta antes y después de cambiarla; undefined si ya no existe.
  private async updateCard(
    topic: string,
    word: string,
    update: (card: Flashcard) => Flashcard
  ): Promise<{ previous: Flashcard; current: Flashcard } | undefined> {
    let change: { previous: Flashcard; current: Flashcard } | undefined;
    await this.studySets.updateCards(topic, cards => cards.map(card => {
      if (card.word !== word) return card;
      change = { previous: card, current: update(card) };
      return change.current;
    }));
    return change;
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

  // Una imagen de tarjeta no cargó o parece la de relleno de Klipy. Si ya no existe, se quita de todas las tarjetas que la
  // usan para buscar otra en la próxima sesión (ver retryMissingImages); sin conexión o si el fallo es pasajero, se queda.
  // No toca el progreso.
  async dropMissingImage(imageUrl: string): Promise<void> {
    if (!imageUrl || this.checkedImages.has(imageUrl)) return;
    this.checkedImages.add(imageUrl);

    try {
      if (!await this.images.isGone(imageUrl)) return;

      const studySets = await this.studySets.getAll();
      for (const { topic } of studySets.filter(studySet => studySet.cards.some(card => card.imageUrl === imageUrl))) {
        await this.studySets.updateCards(topic, cards => cards.map(card =>
          card.imageUrl === imageUrl ? { ...card, imageUrl: '', imageSearchedAt: undefined } : card
        ));
      }
      this.imageDropped.next(imageUrl);
      this.cardsChanged.next();
    } catch (error) {
      console.warn('No se pudo quitar la imagen que ya no existe', imageUrl, error);
    }
  }

  async resetTopic(topic: string): Promise<void> {
    await this.studySets.updateCards(topic, cards => cards.map(resetCard));
  }

  // Todos los temas a la vez, y sin actividad: se van también la racha y las estadísticas.
  async resetAllProgress(): Promise<void> {
    const studySets = await this.studySets.getAll();
    await this.studySets.replaceAll(studySets.map(studySet => ({ ...studySet, cards: studySet.cards.map(resetCard) })), []);
  }

  // Indexado por la clave del tema (toTopicKey).
  async getTopicsProgress(): Promise<Map<string, TopicProgress>> {
    const studySets = await this.studySets.getAll();
    const now = new Date().toISOString();
    return new Map(studySets.map(studySet => [toTopicKey(studySet.topic), {
      known: studySet.cards.filter(isKnownCard).length,
      learning: studySet.cards.filter(card => !isKnownCard(card) && !isNewCard(card)).length,
      pending: studySet.cards.filter(card => !card.learned || this.isDue(card, now)).length,
      newWords: studySet.cards.filter(isNewCard).length,
      total: studySet.cards.length,
      percent: knownStepsPercent(studySet.cards)
    }]));
  }

  async deleteTopic(topic: string): Promise<void> {
    await this.studySets.delete(topic);
  }

  // Leitner: acertar sube una caja y aleja el próximo repaso; fallar la baja lapseBoxes cajas (ver boxAfterLapse), deja
  // de estar aprendida y vuelve mañana. Cada fallo baja otra vez: también el de su repetición en la sesión.
  private applyAnswer(card: Flashcard, knew: boolean): Flashcard {
    const now = new Date();
    if (!knew) {
      return {
        ...card,
        learned: false,
        box: boxAfterLapse(card),
        nextReview: this.startOfDayIn(1),
        misses: (card.misses ?? 0) + 1
      };
    }

    // Acertar una tarjeta que aún no tocaba no adelanta su calendario: su repetición tras fallarla (lo que cuenta es el
    // repaso de mañana), las difíciles al repasarlas o una adelantada.
    if (card.nextReview && card.nextReview > now.toISOString()) {
      return card;
    }

    // En la última caja se queda: sus repasos siguen con el mismo intervalo.
    const box = Math.min((card.box ?? 0) + 1, reviewIntervalDays.length);
    return { ...card, box, learned: box >= learnedBox, nextReview: this.reviewDate(box) };
  }

  // Próximo repaso al llegar a una caja.
  private reviewDate(box: number): string {
    return this.startOfDayIn(reviewIntervalDays[box - 1]);
  }

  // Desde el comienzo de hoy, para que el repaso toque a primera hora de ese día.
  private startOfDayIn(days: number): string {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date.toISOString();
  }

  // Tarjetas que tocan hoy: primero los repasos, también los de mantenimiento de las aprendidas (los más atrasados
  // antes), y luego las palabras nuevas, como mucho `newLimit`.
  private getDueCards(cards: Flashcard[], newLimit: number): Flashcard[] {
    const now = new Date().toISOString();
    const reviews = cards
      .filter(card => this.isDue(card, now))
      .sort((a, b) => (a.nextReview ?? '').localeCompare(b.nextReview ?? ''));
    return [...reviews, ...cards.filter(card => !card.learned && !card.nextReview).slice(0, newLimit)];
  }

  // Ya le toca repaso, aprendida o no. Las nuevas no tienen fecha: no cuentan.
  private isDue(card: Flashcard, now: string): boolean {
    return !!card.nextReview && card.nextReview <= now;
  }

  // La actividad es para las estadísticas y el tope diario: si no se guarda, la respuesta sí vale.
  private async countActivity(day: string, knew: boolean, newWord: boolean, sign: 1 | -1) {
    try {
      await this.studySets.addActivity(day, sign, knew ? sign : 0, newWord ? sign : 0);
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
