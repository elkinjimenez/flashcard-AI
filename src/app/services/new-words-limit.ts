import { loadSetting, saveSetting } from './local-setting';

// Palabras nuevas que se pueden empezar al día. Cada una vuelve al día siguiente, a los 3 días y a los 7: sin tope, un
// día de 40 palabras nuevas trae una avalancha de repasos los días siguientes.
export const newWordsLimits = [
  { id: 5, label: 'Suave' },
  { id: 10, label: 'Normal' },
  { id: 15, label: 'Exigente' },
  { id: 20, label: 'Intensa' },
] as const;

export type NewWordsLimit = typeof newWordsLimits[number]['id'];

const settingName = 'new-words-limit';
const defaultLimit: NewWordsLimit = 10;

export function newWordsLimitLabel(limit: NewWordsLimit): string {
  return newWordsLimits.find(option => option.id === limit)?.label ?? '';
}

export function toNewWordsLimit(value: unknown): NewWordsLimit | undefined {
  return newWordsLimits.find(option => option.id === Number(value))?.id;
}

export function loadNewWordsLimit(): NewWordsLimit {
  return toNewWordsLimit(loadSetting(settingName)) ?? defaultLimit;
}

export function saveNewWordsLimit(limit: NewWordsLimit) {
  saveSetting(settingName, String(limit));
}
