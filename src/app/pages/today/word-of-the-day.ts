import type { Flashcard } from 'src/app/services/flashcard.model';
import { starterTopics } from 'src/app/services/starter-topics';
import { toDayKey } from 'src/app/services/day-key';

export type DailyWord = Pick<Flashcard, 'word' | 'translation'>;

interface StoredWord extends DailyWord {
  // Día local (AAAA-MM-DD) en que se eligió.
  date: string;
}

const storageKey = 'flashcards-ai.word-of-the-day';

// Una de sus palabras (ver dailyWords en Stats), la misma durante todo el día (hora local) aunque entretanto la aprenda o
// falle otras. Sin ninguna (borró todos los temas), una de las de los temas de inicio: siempre hay palabra del día.
export function pickWordOfTheDay(words: DailyWord[], now = new Date()): DailyWord {
  const today = toDayKey(now);
  const stored = loadStoredWord();
  if (stored?.date === today) return { word: stored.word, translation: stored.translation };

  const pool = words.length ? words : ([] as DailyWord[]).concat(...starterTopics.map(topic => topic.words));
  // Sin repetir la del último día mientras haya otras.
  const candidates = pool.length > 1 ? pool.filter(({ word }) => word !== stored?.word) : pool;
  // Sin almacenamiento, el número de día hace que siga siendo la misma en cada visita.
  const dayNumber = Math.round(Date.parse(`${today}T12:00:00Z`) / 86_400_000);
  const { word, translation } = candidates[dayNumber % candidates.length];
  saveStoredWord({ date: today, word, translation });
  return { word, translation };
}

// Al reiniciar el progreso: la de hoy ya no le cuesta.
export function forgetWordOfTheDay() {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // Sin almacenamiento no hay nada guardado.
  }
}

function loadStoredWord(): StoredWord | null {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    return typeof stored?.date === 'string' && typeof stored.word === 'string' && typeof stored.translation === 'string'
      ? stored
      : null;
  } catch {
    return null;
  }
}

function saveStoredWord(word: StoredWord) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(word));
  } catch {
    // Sin almacenamiento, se vuelve a elegir en cada visita (con el mismo número de día).
  }
}
