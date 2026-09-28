import { loadSetting, saveSetting } from './local-setting';

// Respuestas al día, las mismas que cuenta la actividad diaria (Progreso). Una sesión de 10 palabras son unas 10 a 15.
export const dailyGoals = [
  { id: 10, label: 'Suave' },
  { id: 20, label: 'Normal' },
  { id: 30, label: 'Exigente' },
  { id: 50, label: 'Intensa' },
] as const;

export type DailyGoal = typeof dailyGoals[number]['id'];

const settingName = 'daily-goal';
const defaultGoal: DailyGoal = 20;

export function dailyGoalLabel(goal: DailyGoal): string {
  return dailyGoals.find(option => option.id === goal)?.label ?? '';
}

export function toDailyGoal(value: unknown): DailyGoal | undefined {
  return dailyGoals.find(option => option.id === Number(value))?.id;
}

export function loadDailyGoal(): DailyGoal {
  return toDailyGoal(loadSetting(settingName)) ?? defaultGoal;
}

export function saveDailyGoal(goal: DailyGoal) {
  saveSetting(settingName, String(goal));
}
