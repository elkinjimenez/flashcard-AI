// Niveles del MCER que se ofrecen. El nivel decide la dificultad de las palabras nuevas y de sus frases de ejemplo.
export const englishLevels = [
  { id: 'A1', label: 'Principiante' },
  { id: 'A2', label: 'Básico' },
  { id: 'B1', label: 'Intermedio' },
  { id: 'B2', label: 'Intermedio alto' },
  { id: 'C1', label: 'Avanzado' },
] as const;

export type EnglishLevel = typeof englishLevels[number]['id'];

const storageKey = 'flashcards-ai.level';
const defaultLevel: EnglishLevel = 'A2';

export function englishLevelLabel(level: EnglishLevel): string {
  return englishLevels.find(option => option.id === level)?.label ?? '';
}

// Si el almacenamiento falla (navegación privada, datos bloqueados) se usa el nivel por defecto.
export function loadEnglishLevel(): EnglishLevel {
  try {
    const stored = localStorage.getItem(storageKey);
    return englishLevels.find(option => option.id === stored)?.id ?? defaultLevel;
  } catch {
    return defaultLevel;
  }
}

export function saveEnglishLevel(level: EnglishLevel) {
  try {
    localStorage.setItem(storageKey, level);
  } catch {
    // Sin almacenamiento, el nivel solo dura hasta que se cierre la app.
  }
}
