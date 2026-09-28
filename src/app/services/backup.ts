import { Injectable, inject } from '@angular/core';
import { DailyActivity, StoredStudySet, StudySetRepository } from './study-set-repository';
import { EnglishLevel, loadEnglishLevel, saveEnglishLevel, toEnglishLevel } from './english-level';
import { DailyGoal, loadDailyGoal, saveDailyGoal, toDailyGoal } from './daily-goal';
import { NewWordsLimit, loadNewWordsLimit, saveNewWordsLimit, toNewWordsLimit } from './new-words-limit';
import { ThemeMode, ThemeService, toThemeMode } from './theme';
import { PronunciationService, SpeechRate, toSpeechRate } from './pronunciation';

const appId = 'flashcards-ai';
// Sube si cambia la forma del JSON: los respaldos de una versión más nueva no se pueden leer.
const backupVersion = 1;
// Va delante del código, al final del mensaje. Al importar, el código se busca por él.
const codePrefix = 'FCAI:';
const codePattern = /FCAI:([A-Za-z0-9+/=\s]+)/;
// "28/09/2026".
const dateFormat = new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' });

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

// Deflate y base64: el código queda en un tercio del JSON. CompressionStream requiere iOS 16.4+ o un Chrome reciente.
async function compress(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  // Byte a byte: String.fromCharCode(...bytes) desborda la pila con textos grandes.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function decompress(code: string): Promise<string> {
  const bytes = Uint8Array.from(atob(code), char => char.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}

// Todos los datos de la app en un mensaje de texto, para compartirlo como cualquier otro (p. ej. por WhatsApp): los temas
// con sus tarjetas y su progreso, la actividad diaria (la racha) y los ajustes. Solo se guardan en el dispositivo: el
// respaldo sirve para no perderlos o para pasarlos a otro.
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

  // Un texto legible con el código al final, en su propia línea. Comprimir es asíncrono: se prepara antes del toque
  // de compartir (ver SettingsPage).
  async createMessage(): Promise<string> {
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

    const code = await compress(JSON.stringify(backup));
    return `📦 Respaldo de Flashcards AI · ${dateFormat.format(new Date())}\n\n`
      + 'Para recuperar tus datos: en la app toca Ajustes › Respaldo › "Importar" y pega este mensaje completo.\n\n'
      + `${codePrefix}${code}`;
  }

  // Lee y comprueba el mensaje pegado sin tocar nada, para poder confirmar antes de reemplazar. Sin el código, prueba
  // el texto como JSON: así también sirve el contenido de una copia vieja en .json.
  async parse(text: string): Promise<Backup> {
    if (!text.trim()) throw new BackupError('Pega el mensaje del respaldo.');

    const match = codePattern.exec(text);
    if (match && typeof DecompressionStream === 'undefined') {
      throw new BackupError('Este navegador no puede leer el respaldo. Actualízalo e inténtalo de nuevo.');
    }
    let data: unknown;
    try {
      // Al copiar o reenviar se cuelan espacios y saltos de línea.
      data = JSON.parse(match ? await decompress(match[1].replace(/\s/g, '')) : text);
    } catch (error) {
      console.error('El texto no es un respaldo', error);
      throw new BackupError('El texto no es un respaldo válido. Revisa que hayas copiado el mensaje completo.');
    }
    return this.validate(data);
  }

  private validate(data: unknown): Backup {
    if (!isObject(data) || data['app'] !== appId) {
      throw new BackupError('El texto no es un respaldo de Flashcards AI.');
    }
    if (typeof data['version'] !== 'number' || data['version'] > backupVersion) {
      throw new BackupError('El respaldo es de una versión más nueva de la app. Actualízala e inténtalo de nuevo.');
    }
    const { studySets, activity } = data;
    if (!Array.isArray(studySets) || !studySets.every(isStudySet)
      || !Array.isArray(activity) || !activity.every(isActivity)) {
      throw new BackupError('El respaldo está incompleto o dañado. Revisa que hayas copiado el mensaje completo.');
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

  // Reemplaza todos los temas y la actividad por los del respaldo, y aplica sus ajustes.
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
