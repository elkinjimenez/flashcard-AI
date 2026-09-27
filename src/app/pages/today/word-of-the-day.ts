import { HardWord } from 'src/app/services/stats';
import { toDayKey } from 'src/app/services/day-key';

export type DailyWord = Pick<HardWord, 'word' | 'translation'>;

interface StoredWord extends DailyWord {
  // Día local (AAAA-MM-DD) en que se eligió.
  date: string;
}

const storageKey = 'flashcards-ai.word-of-the-day';

// Una de las palabras que más le cuestan (ver hardestWords), la misma durante todo el día (hora local) aunque entretanto
// la aprenda o falle otras. null si aún no falló ninguna.
export function pickWordOfTheDay(hardWords: DailyWord[], now = new Date()): DailyWord | null {
  const today = toDayKey(now);
  const stored = loadStoredWord();
  if (stored?.date === today) return { word: stored.word, translation: stored.translation };
  if (!hardWords.length) return null;

  // Sin repetir la del último día mientras haya otras.
  const candidates = hardWords.length > 1 ? hardWords.filter(({ word }) => word !== stored?.word) : hardWords;
  // Sin almacenamiento, el número de día hace que siga siendo la misma en cada visita.
  const dayNumber = Math.round(Date.parse(`${today}T12:00:00Z`) / 86_400_000);
  const { word, translation } = candidates[dayNumber % candidates.length];
  saveStoredWord({ date: today, word, translation });
  return { word, translation };
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
