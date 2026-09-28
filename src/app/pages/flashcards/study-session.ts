import { AnswerRecord, Flashcard } from 'src/app/services/flashcard';
import { boxAfterLapse, isNewCard } from 'src/app/services/flashcard.model';
import { SummaryWord } from './session-summary/session-summary.component';

// Tarjetas entre la presentación de una palabra nueva y su primer ejercicio: así hay que recordarla, no solo repetirla.
const introGap = 3;

// Tarjetas entre el fallo de una palabra y su repetición (de 3 a 5, al azar): pronto, cuando recordarla aún cuesta
// un poco, que es lo que más la fija.
const minRetryGap = 3;
const maxRetryGap = 5;

export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// El guardado de una respuesta: undefined si no se pudo guardar.
export type SavedAnswer = Promise<AnswerRecord | undefined>;

// Lo que se hizo con una tarjeta, con lo necesario para deshacerlo.
export interface SessionStep {
  index: number;
  card: Flashcard;
  knew: boolean;
  previousResult?: 'knew' | 'hard';
  saved: SavedAnswer;
  // Si falló, dónde se metió su repetición.
  retryAt?: number;
  // "Ya la conozco": dónde estaba su ejercicio, que se quitó.
  skippedAt?: number;
}

// El orden de las tarjetas de una sesión y lo respondido en ella: presentaciones de las nuevas, repeticiones de las
// falladas y el historial para deshacer. No guarda nada: la página guarda cada respuesta y le pasa su guardado.
export class StudySession {
  private position = 0;
  // Resultado de cada palabra en la sesión; 'hard' si se marcó difícil al menos una vez.
  private results = new Map<string, 'knew' | 'hard'>();
  private steps: SessionStep[] = [];

  // intros: posiciones de `cards` que presentan una palabra nueva. Se desplazan al meter o quitar tarjetas (ver
  // insertCard).
  constructor(private cards: Flashcard[] = [], private intros = new Set<number>()) {}

  // Cada palabra nueva sale dos veces: primero presentada y `introGap` tarjetas después en un ejercicio.
  static plan(sessionCards: Flashcard[]): StudySession {
    const cards: Flashcard[] = [];
    const intros = new Set<number>();
    // Presentadas que esperan su ejercicio, con la posición desde la que les toca.
    const waiting: { card: Flashcard; at: number }[] = [];
    const addWaiting = () => {
      while (waiting.length && waiting[0].at <= cards.length) {
        cards.push(waiting.shift()!.card);
      }
    };

    for (const card of shuffle(sessionCards)) {
      addWaiting();
      if (isNewCard(card)) {
        intros.add(cards.length);
        waiting.push({ card, at: cards.length + 1 + introGap });
      }
      cards.push(card);
    }
    // Al final no quedan tarjetas con que separarlas: van seguidas.
    cards.push(...waiting.map(item => item.card));
    return new StudySession(cards, intros);
  }

  get current(): Flashcard | undefined {
    return this.cards[this.position];
  }

  // La actual presenta una palabra nueva, sin preguntar.
  get isIntro(): boolean {
    return this.intros.has(this.position);
  }

  get canUndo(): boolean {
    return this.steps.length > 0;
  }

  // Palabras distintas: las tarjetas son más, porque cada palabra nueva sale dos veces (presentación y ejercicio) y las
  // falladas se repiten.
  get words(): number {
    return new Set(this.cards.map(card => card.word)).size;
  }

  // Las que ya no volverán a salir. La actual cuenta en cuanto se responde su ejercicio (answered), salvo si se falla:
  // su repetición sigue pendiente.
  completedWords(answered: boolean): number {
    const pending = this.cards.slice(answered ? this.position + 1 : this.position);
    return this.words - new Set(pending.map(card => card.word)).size;
  }

  // Sabidas y difíciles (falladas al menos una vez).
  get tally(): { knew: number; hard: number } {
    const results = [...this.results.values()];
    const hard = results.filter(result => result === 'hard').length;
    return { knew: results.length - hard, hard };
  }

  // Pasa a la siguiente; false si no quedan: la sesión terminó.
  next(): boolean {
    if (this.position >= this.cards.length - 1) return false;
    this.position++;
    return true;
  }

  // Apunta la respuesta de la actual. La difícil se repite unas tarjetas después (al final, si quedan menos), en la caja
  // a la que baja como queda guardada: sus ejercicios son los de esa etapa (ver stageOf en la página). hardRound se
  // queda con esta copia, la última de cada palabra.
  answer(knew: boolean, saved: SavedAnswer): SessionStep {
    const card = this.cards[this.position];
    const step: SessionStep = { index: this.position, card, knew, previousResult: this.results.get(card.word), saved };
    this.steps.push(step);
    if (knew) {
      if (!this.results.has(card.word)) {
        this.results.set(card.word, 'knew');
      }
    } else {
      this.results.set(card.word, 'hard');
      const gap = minRetryGap + Math.floor(Math.random() * (maxRetryGap - minRetryGap + 1));
      step.retryAt = Math.min(this.position + 1 + gap, this.cards.length);
      this.insertCard(step.retryAt, { ...card, box: boxAfterLapse(card) });
    }
    return step;
  }

  // Ya la conocía (en su presentación): cuenta como La sé y se quita su ejercicio.
  markKnown(saved: SavedAnswer) {
    const step = this.answer(true, saved);
    // Por palabra: cambiar la imagen crea copias nuevas de la tarjeta. Detrás de la presentación solo está su ejercicio.
    const skippedAt = this.cards.findIndex((other, index) => index > this.position && other.word === step.card.word);
    if (skippedAt >= 0) {
      step.skippedAt = skippedAt;
      this.removeCard(skippedAt);
    }
  }

  // Deshace la última respuesta y vuelve a su tarjeta. Devuelve el paso deshecho, para deshacer también su guardado.
  undo(): SessionStep | undefined {
    const step = this.steps.pop();
    if (!step) return undefined;

    this.position = step.index;
    if (step.previousResult) {
      this.results.set(step.card.word, step.previousResult);
    } else {
      this.results.delete(step.card.word);
    }
    // Su repetición sigue en retryAt: las que se metieron después ya se quitaron al deshacer sus pasos, que van antes.
    if (step.retryAt !== undefined) {
      this.removeCard(step.retryAt);
    }
    // "Ya la conozco": vuelve su ejercicio.
    if (step.skippedAt !== undefined) {
      this.insertCard(step.skippedAt, step.card);
    }
    return step;
  }

  // En todas las tarjetas, también las copias que aún no salieron (p. ej. al cambiar una imagen).
  updateCards(update: (card: Flashcard, isCurrent: boolean) => Flashcard) {
    this.cards = this.cards.map((card, index) => update(card, index === this.position));
  }

  // Las difíciles, en una sesión nueva: sin presentaciones (ya se presentaron) ni forma de volver a esta.
  hardRound(): StudySession {
    const hardCards = new Map(
      this.cards
        .filter(card => this.results.get(card.word) === 'hard')
        .map(card => [card.word, card])
    );
    return new StudySession(shuffle([...hardCards.values()]));
  }

  // Por palabra: cómo estaba en su primera respuesta guardada y cómo quedó tras la última, cuando se guarden. Las que no
  // se pudieron guardar no salen.
  async summaryWords(): Promise<SummaryWord[]> {
    const steps = [...this.steps];
    const records = await Promise.all(steps.map(step => step.saved));
    const words = new Map<string, SummaryWord>();
    records.forEach((record, index) => {
      if (!record) return;
      const { card, knew } = steps[index];
      const first = words.get(card.word);
      // La imagen, de la sesión: pudo cambiarse después de responder.
      const imageUrl = this.cards.find(other => other.word === card.word)?.imageUrl ?? record.current.imageUrl;
      words.set(card.word, {
        card: { ...record.current, imageUrl },
        before: first?.before ?? record.previous,
        hard: (first?.hard ?? false) || !knew
      });
    });
    return [...words.values()];
  }

  // Las presentaciones que quedan detrás se desplazan con ella.
  private insertCard(position: number, card: Flashcard) {
    this.cards.splice(position, 0, card);
    this.intros = new Set([...this.intros].map(index => index >= position ? index + 1 : index));
  }

  private removeCard(position: number) {
    this.cards.splice(position, 1);
    this.intros = new Set([...this.intros].map(index => index > position ? index - 1 : index));
  }
}
