import { Injectable, inject } from '@angular/core';
import { Flashcard, isNewCard } from './flashcard.model';
import { DailyActivity, StudySetRepository } from './study-set-repository';
import { toDayKey } from './day-key';

// En qué punto del aprendizaje está cada palabra (Leitner): de menos a más avanzada.
export type WordStage = 'new' | 'learning' | 'consolidating' | 'learned';

export interface TopicStats {
  topic: string;
  // Igual que en la pantalla de temas: acertadas en su último repaso o ya aprendidas.
  known: number;
  total: number;
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
      stages[this.stageOf(card)]++;
    }

    const answersByDay = new Map(activity.filter(day => day.answers > 0).map(day => [day.date, day]));
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
          known: studySet.cards.filter(card => card.learned || (card.box ?? 0) >= 1).length,
          total: studySet.cards.length
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

  // Nueva: aún no se respondió. Aprendiendo: cajas 0 a 2. Afianzada: cajas 3 a 5, a un paso de aprenderse.
  private stageOf(card: Flashcard): WordStage {
    if (card.learned) return 'learned';
    if (isNewCard(card)) return 'new';
    return (card.box ?? 0) >= 3 ? 'consolidating' : 'learning';
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
