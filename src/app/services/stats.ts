import { Injectable, inject } from '@angular/core';
import { Flashcard, isKnownCard, isNewCard, knownFromBox } from './flashcard.model';
import { DailyActivity, StudySetRepository } from './study-set-repository';
import { toDayKey } from './day-key';

// En qué punto del aprendizaje está cada palabra (Leitner): de menos a más avanzada. Con su nombre para una palabra y
// para varias.
export const wordStages = [
  { id: 'new', label: 'Nueva', plural: 'Nuevas' },
  { id: 'learning', label: 'Aprendiendo', plural: 'Aprendiendo' },
  { id: 'consolidating', label: 'Afianzada', plural: 'Afianzadas' },
  { id: 'learned', label: 'Aprendida', plural: 'Aprendidas' },
] as const;

export type WordStage = typeof wordStages[number]['id'];

export interface TopicStats {
  topic: string;
  // Igual que en la pantalla de temas: afianzadas o aprendidas (ver isKnownCard).
  known: number;
  // Empezadas, aún sin saberlas: el tramo claro de la barra.
  learning: number;
  total: number;
  // Repasos que ya tocan, como dueToday.
  due: number;
}

export interface Streak {
  // Días seguidos practicando hasta hoy. Si hoy aún no practicó, cuenta hasta ayer: la racha sigue viva.
  current: number;
  best: number;
}

export interface HardWord extends Pick<Flashcard, 'word' | 'translation' | 'imageUrl' | 'mnemonic'> {
  misses: number;
  topic: string;
}

export interface Stats {
  totalWords: number;
  stages: Record<WordStage, number>;
  // Días seguidos practicando hasta hoy. Si hoy aún no practicó, cuenta hasta ayer: la racha sigue viva.
  streak: number;
  bestStreak: number;
  // Últimos 7 días, del más antiguo a hoy; los días sin práctica van con 0.
  week: DailyActivity[];
  // Aciertos de la semana (0..1); null si no respondió nada.
  weekAccuracy: number | null;
  // Repasos que ya tocan, también los de mantenimiento de las aprendidas (las palabras nuevas no cuentan), y los que
  // tocarán mañana.
  dueToday: number;
  dueTomorrow: number;
  topics: TopicStats[];
  // Las más falladas que aún no se aprendieron.
  hardestWords: HardWord[];
}

const dayMs = 24 * 60 * 60 * 1000;

// Nueva: aún no se respondió. Aprendiendo: cajas 0 a 2. Afianzada: desde la caja 3 (knownFromBox), ya cuenta como
// sabida (también una aprendida que se falló y aún no acertó su repaso).
export function wordStage(card: Flashcard): WordStage {
  if (card.learned) return 'learned';
  if (isNewCard(card)) return 'new';
  return (card.box ?? 0) >= knownFromBox ? 'consolidating' : 'learning';
}

export function wordStageLabel(card: Flashcard): string {
  const stage = wordStage(card);
  return wordStages.find(option => option.id === stage)?.label ?? '';
}

@Injectable({ providedIn: 'root' })
export class StatsService {
  private studySets = inject(StudySetRepository);

  async getStats(now = new Date()): Promise<Stats> {
    const [studySets, activity] = await Promise.all([this.studySets.getAll(), this.studySets.getActivity()]);
    const cards = ([] as { card: Flashcard; topic: string }[]).concat(
      ...studySets.map(studySet => studySet.cards.map(card => ({ card, topic: studySet.topic })))
    );

    const stages: Record<WordStage, number> = { new: 0, learning: 0, consolidating: 0, learned: 0 };
    for (const { card } of cards) {
      stages[wordStage(card)]++;
    }

    const answersByDay = this.activeDays(activity);
    const week = Array.from({ length: 7 }, (_, index) => {
      const date = toDayKey(this.addDays(now, index - 6));
      return answersByDay.get(date) ?? { date, answers: 0, correct: 0 };
    });
    const weekAnswers = week.reduce((sum, day) => sum + day.answers, 0);
    const weekCorrect = week.reduce((sum, day) => sum + day.correct, 0);

    const nowIso = now.toISOString();
    const dayAfterTomorrow = this.startOfDay(this.addDays(now, 2)).toISOString();
    // También las aprendidas: tienen sus repasos de mantenimiento.
    const pending = cards.filter(({ card }) => card.nextReview);

    return {
      totalWords: cards.length,
      stages,
      streak: this.currentStreak(answersByDay, now),
      bestStreak: this.bestStreak([...answersByDay.keys()]),
      week,
      weekAccuracy: weekAnswers ? weekCorrect / weekAnswers : null,
      dueToday: pending.filter(({ card }) => card.nextReview! <= nowIso).length,
      dueTomorrow: pending.filter(({ card }) => card.nextReview! > nowIso && card.nextReview! < dayAfterTomorrow).length,
      topics: studySets
        .map(studySet => ({
          topic: studySet.topic,
          known: studySet.cards.filter(isKnownCard).length,
          learning: studySet.cards.filter(card => !isKnownCard(card) && !isNewCard(card)).length,
          total: studySet.cards.length,
          due: studySet.cards.filter(card => card.nextReview && card.nextReview <= nowIso).length
        }))
        .filter(topic => topic.total)
        .sort((a, b) => a.topic.localeCompare(b.topic, 'es')),
      hardestWords: cards
        .filter(({ card }) => !card.learned && (card.misses ?? 0) > 0)
        .sort((a, b) => (b.card.misses ?? 0) - (a.card.misses ?? 0))
        .slice(0, 5)
        .map(({ card, topic }) => ({
          word: card.word,
          translation: card.translation,
          imageUrl: card.imageUrl,
          mnemonic: card.mnemonic,
          misses: card.misses ?? 0,
          topic
        }))
    };
  }

  // Solo la racha, sin leer las palabras: la muestra el resumen de la sesión.
  async getStreak(now = new Date()): Promise<Streak> {
    const answersByDay = this.activeDays(await this.studySets.getActivity());
    return { current: this.currentStreak(answersByDay, now), best: this.bestStreak([...answersByDay.keys()]) };
  }

  // Días con alguna respuesta (deshacerlas puede dejar un día a 0), por su clave.
  private activeDays(activity: DailyActivity[]): Map<string, DailyActivity> {
    return new Map(activity.filter(day => day.answers > 0).map(day => [day.date, day]));
  }

  private currentStreak(answersByDay: Map<string, DailyActivity>, now: Date): number {
    let day = answersByDay.has(toDayKey(now)) ? now : this.addDays(now, -1);
    let streak = 0;
    while (answersByDay.has(toDayKey(day))) {
      streak++;
      day = this.addDays(day, -1);
    }
    return streak;
  }

  private bestStreak(days: string[]): number {
    let best = 0;
    let current = 0;
    let previous: number | undefined;
    // AAAA-MM-DD a mediodía UTC: restar dos fechas da días enteros aunque haya cambio de hora.
    for (const time of days.map(day => Date.parse(`${day}T12:00:00Z`)).sort((a, b) => a - b)) {
      current = previous !== undefined && Math.round((time - previous) / dayMs) === 1 ? current + 1 : 1;
      best = Math.max(best, current);
      previous = time;
    }
    return best;
  }

  // Por calendario, no sumando 24 h: así no se salta ni repite un día con el cambio de hora.
  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }
}
