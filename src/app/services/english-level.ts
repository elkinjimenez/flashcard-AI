import { loadSetting, saveSetting } from './local-setting';

// Niveles del MCER que se ofrecen. El nivel decide la dificultad de las palabras nuevas y de sus frases de ejemplo.
export const englishLevels = [
  { id: 'A1', label: 'Principiante' },
  { id: 'A2', label: 'Básico' },
  { id: 'B1', label: 'Intermedio' },
  { id: 'B2', label: 'Intermedio alto' },
  { id: 'C1', label: 'Avanzado' },
] as const;

export type EnglishLevel = typeof englishLevels[number]['id'];

const settingName = 'level';
const defaultLevel: EnglishLevel = 'A2';

export function englishLevelLabel(level: EnglishLevel): string {
  return englishLevels.find(option => option.id === level)?.label ?? '';
}

export function toEnglishLevel(value: unknown): EnglishLevel | undefined {
  return englishLevels.find(option => option.id === value)?.id;
}

export function loadEnglishLevel(): EnglishLevel {
  return toEnglishLevel(loadSetting(settingName)) ?? defaultLevel;
}

export function saveEnglishLevel(level: EnglishLevel) {
  saveSetting(settingName, level);
}
