import { Injectable, inject } from '@angular/core';
import { DailyActivity, StoredStudySet, StudySetRepository } from './study-set-repository';
import { toDayKey } from './day-key';
import { EnglishLevel, loadEnglishLevel, saveEnglishLevel, toEnglishLevel } from './english-level';
import { DailyGoal, loadDailyGoal, saveDailyGoal, toDailyGoal } from './daily-goal';
import { NewWordsLimit, loadNewWordsLimit, saveNewWordsLimit, toNewWordsLimit } from './new-words-limit';
import { ThemeMode, ThemeService, toThemeMode } from './theme';
import { PronunciationService, SpeechRate, toSpeechRate } from './pronunciation';

const appId = 'flashcards-ai';
// Sube si cambia la forma del archivo: las copias de una versión más nueva no se pueden leer.
const backupVersion = 1;

// La voz no va: cada dispositivo tiene las suyas.
interface BackupSettings {
  level?: EnglishLevel;
  dailyGoal?: DailyGoal;
  newWordsLimit?: NewWordsLimit;
  theme?: ThemeMode;
  speechRate?: SpeechRate;
}

export interface Backup {
  app: typeof appId;
  version: number;
  exportedAt: string;
  studySets: StoredStudySet[];
  activity: DailyActivity[];
  settings: BackupSettings;
}

export interface BackupSummary {
  topics: number;
  words: number;
}

// Su mensaje se puede mostrar tal cual.
export class BackupError extends Error {}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStudySet(value: unknown): value is StoredStudySet {
  return isObject(value) && typeof value['topic'] === 'string' && Array.isArray(value['cards'])
    && value['cards'].every(card => isObject(card) && typeof card['word'] === 'string'
      && typeof card['translation'] === 'string');
}

function isActivity(value: unknown): value is DailyActivity {
  return isObject(value) && typeof value['date'] === 'string' && typeof value['answers'] === 'number'
    && typeof value['correct'] === 'number';
}

// Todos los datos de la app en un archivo JSON: los temas con sus tarjetas y su progreso, la actividad diaria (la racha)
// y los ajustes. Solo se guardan en el dispositivo: la copia sirve para no perderlos o para pasarlos a otro.
@Injectable({ providedIn: 'root' })
export class BackupService {
  private studySets = inject(StudySetRepository);
  private theme = inject(ThemeService);
  private pronunciation = inject(PronunciationService);

  async currentSummary(): Promise<BackupSummary> {
    return this.summarize(await this.studySets.getAll());
  }

  summarize(studySets: StoredStudySet[]): BackupSummary {
    return {
      topics: studySets.length,
      words: studySets.reduce((sum, studySet) => sum + studySet.cards.length, 0)
    };
  }

  async download(): Promise<void> {
    const [studySets, activity] = await Promise.all([this.studySets.getAll(), this.studySets.getActivity()]);
    const backup: Backup = {
      app: appId,
      version: backupVersion,
      exportedAt: new Date().toISOString(),
      studySets,
      activity,
      settings: {
        level: loadEnglishLevel(),
        dailyGoal: loadDailyGoal(),
        newWordsLimit: loadNewWordsLimit(),
        theme: this.theme.mode,
        speechRate: this.pronunciation.rate
      }
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `flashcards-ai-${toDayKey(new Date())}.json`;
    link.click();
    // Safari puede seguir leyéndolo un rato después del clic.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  // Lee y comprueba el archivo sin tocar nada, para poder confirmar antes de reemplazar.
  async read(file: File): Promise<Backup> {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      data = null;
    }
    if (!isObject(data) || data['app'] !== appId) {
      throw new BackupError('El archivo no es una copia de seguridad de Flashcards AI.');
    }
    if (typeof data['version'] !== 'number' || data['version'] > backupVersion) {
      throw new BackupError('La copia es de una versión más nueva de la app. Actualízala e inténtalo de nuevo.');
    }
    const { studySets, activity } = data;
    if (!Array.isArray(studySets) || !studySets.every(isStudySet)
      || !Array.isArray(activity) || !activity.every(isActivity)) {
      throw new BackupError('La copia está dañada: no se puede restaurar.');
    }

    const settings = isObject(data['settings']) ? data['settings'] : {};
    return {
      app: appId,
      version: data['version'],
      exportedAt: typeof data['exportedAt'] === 'string' ? data['exportedAt'] : '',
      studySets,
      activity,
      settings: {
        level: toEnglishLevel(settings['level']),
        dailyGoal: toDailyGoal(settings['dailyGoal']),
        newWordsLimit: toNewWordsLimit(settings['newWordsLimit']),
        theme: toThemeMode(settings['theme']),
        speechRate: toSpeechRate(settings['speechRate'])
      }
    };
  }

  // Reemplaza todos los temas y la actividad por los de la copia, y aplica sus ajustes.
  async restore(backup: Backup): Promise<void> {
    await this.studySets.replaceAll(backup.studySets, backup.activity);

    const { level, dailyGoal, newWordsLimit, theme, speechRate } = backup.settings;
    if (level) saveEnglishLevel(level);
    if (dailyGoal) saveDailyGoal(dailyGoal);
    if (newWordsLimit) saveNewWordsLimit(newWordsLimit);
    if (theme) this.theme.setMode(theme);
    if (speechRate) this.pronunciation.setRate(speechRate);
  }
}
