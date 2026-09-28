import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AlertController, IonButton, IonContent, IonIcon, IonLabel, IonSegment, IonSegmentButton, IonSelect, IonSelectOption,
  IonSpinner, IonToggle
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  cloudUploadOutline, downloadOutline, moonOutline, phonePortraitOutline, sunnyOutline, volumeHighOutline
} from 'ionicons/icons';
import {
  EnglishLevel, englishLevelLabel, englishLevels, loadEnglishLevel, saveEnglishLevel
} from 'src/app/services/english-level';
import { DailyGoal, dailyGoalLabel, dailyGoals, loadDailyGoal, saveDailyGoal } from 'src/app/services/daily-goal';
import {
  NewWordsLimit, loadNewWordsLimit, newWordsLimitLabel, newWordsLimits, saveNewWordsLimit
} from 'src/app/services/new-words-limit';
import { PronunciationService, SpeechRate, speechRates, voiceLanguage } from 'src/app/services/pronunciation';
import { ThemeMode, ThemeService, themeModes } from 'src/app/services/theme';
import { Backup, BackupError, BackupService, BackupSummary } from 'src/app/services/backup';
import { FlashcardService } from 'src/app/services/flashcard';
import { StoragePersistence, StoragePersistenceService } from 'src/app/services/storage-persistence';
import { ToastService } from 'src/app/services/toast';
import { AnswerFeedbackService } from 'src/app/services/answer-feedback';
import { count } from 'src/app/services/count';

interface VoiceOption {
  id: string;
  label: string;
}

// Valor de la voz automática en el selector.
const automaticVoice = 'auto';
const voiceSample = 'Hello! This is how I sound. Practice makes perfect.';

// Países de las voces en inglés más comunes; los demás van con su código.
const regionNames: Record<string, string> = {
  US: 'EE. UU.', GB: 'Reino Unido', AU: 'Australia', CA: 'Canadá', IE: 'Irlanda', NZ: 'Nueva Zelanda',
  IN: 'India', ZA: 'Sudáfrica', SG: 'Singapur', PH: 'Filipinas', HK: 'Hong Kong', NG: 'Nigeria', KE: 'Kenia'
};
// "12 de septiembre de 2026".
const dateFormat = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });

// "Microsoft Aria Online (Natural) - English (United States)" -> "Aria (Natural) · EE. UU.".
function voiceLabel(voice: SpeechSynthesisVoice): string {
  const name = voice.name.replace(/^(Microsoft|Apple)\s+/, '').replace(/\s+-\s+.*$/, '').replace(/\s+Online/, '');
  const region = voiceLanguage(voice).split('-')[1]?.toUpperCase();
  return region ? `${name} · ${regionNames[region] ?? region}` : name;
}

// Ajustes de la app: el nivel, la meta diaria, la voz, el sonido y la vibración al responder, el tema claro u oscuro y
// la copia de seguridad. Todo se guarda al cambiarlo.
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonSegment, IonSegmentButton, IonLabel, IonSelect, IonSelectOption, IonButton, IonIcon, IonSpinner,
    IonToggle
  ],
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
})
export class SettingsPage {
  private pronunciation = inject(PronunciationService);
  private theme = inject(ThemeService);
  private backup = inject(BackupService);
  private storagePersistence = inject(StoragePersistenceService);
  private feedback = inject(AnswerFeedbackService);
  private alertController = inject(AlertController);
  private toast = inject(ToastService);

  readonly levels = englishLevels;
  readonly goals = dailyGoals;
  readonly newWordsLimits = newWordsLimits;
  readonly rates = speechRates;
  readonly themeModes = themeModes;
  readonly automaticVoice = automaticVoice;
  readonly canSpeak = this.pronunciation.available;
  readonly canVibrate = this.feedback.canVibrate;
  readonly count = count;

  level: EnglishLevel = loadEnglishLevel();
  dailyGoal: DailyGoal = loadDailyGoal();
  newWordsLimit: NewWordsLimit = loadNewWordsLimit();
  voices: VoiceOption[] = [];
  voiceId = automaticVoice;
  // La que suena con «Automática».
  automaticVoiceLabel = '';
  rate: SpeechRate = this.pronunciation.rate;
  themeMode: ThemeMode = this.theme.mode;
  sounds = this.feedback.sounds;
  vibration = this.feedback.vibration;
  // Lo que hay ahora en el dispositivo; null mientras se lee o si falla.
  summary: BackupSummary | null = null;
  // Si el navegador puede borrar los datos cuando le falta espacio (ver StoragePersistenceService).
  persistence: StoragePersistence = 'unsupported';
  downloading = false;
  restoring = false;

  @ViewChild('backupFile') private backupFile!: ElementRef<HTMLInputElement>;

  constructor() {
    addIcons({ cloudUploadOutline, downloadOutline, moonOutline, phonePortraitOutline, sunnyOutline, volumeHighOutline });
    this.pronunciation.voicesChanged.pipe(takeUntilDestroyed()).subscribe(() => this.loadVoices());
    inject(FlashcardService).cardsChanged.pipe(takeUntilDestroyed()).subscribe(() => this.loadSummary());
  }

  ionViewWillEnter() {
    this.loadVoices();
    return this.loadSummary();
  }

  get levelLabel(): string {
    return englishLevelLabel(this.level);
  }

  get goalLabel(): string {
    return dailyGoalLabel(this.dailyGoal);
  }

  // Los repasos diarios que acaba trayendo: cada palabra vuelve a los 1, 3 y 7 días (sin contar fallos).
  get newWordsLimitLabel(): string {
    return `${newWordsLimitLabel(this.newWordsLimit)} · en un par de semanas, unos ${this.newWordsLimit * 3} repasos al día`;
  }

  setLevel(level: EnglishLevel) {
    this.level = level;
    saveEnglishLevel(level);
  }

  setDailyGoal(goal: DailyGoal) {
    this.dailyGoal = goal;
    saveDailyGoal(goal);
  }

  setNewWordsLimit(limit: NewWordsLimit) {
    this.newWordsLimit = limit;
    saveNewWordsLimit(limit);
  }

  // Al elegirla suena: así se compara de oído.
  setVoice(voiceId: string) {
    this.voiceId = voiceId;
    this.pronunciation.setVoice(voiceId === automaticVoice ? null : voiceId);
    this.testVoice();
  }

  setRate(rate: SpeechRate) {
    this.rate = rate;
    this.pronunciation.setRate(rate);
    this.testVoice();
  }

  testVoice() {
    this.pronunciation.speakText(voiceSample);
  }

  setSounds(on: boolean) {
    this.sounds = on;
    this.feedback.setSounds(on);
  }

  setVibration(on: boolean) {
    this.vibration = on;
    this.feedback.setVibration(on);
  }

  setTheme(mode: ThemeMode) {
    this.themeMode = mode;
    this.theme.setMode(mode);
  }

  async downloadBackup() {
    if (this.downloading) return;

    this.downloading = true;
    try {
      await this.backup.download();
    } catch (error) {
      console.error('No se pudo crear la copia de seguridad', error);
      this.toast.show('No se pudo crear la copia de seguridad.', { color: 'danger' });
    } finally {
      this.downloading = false;
    }
  }

  chooseBackupFile() {
    this.backupFile.nativeElement.click();
  }

  async restoreBackup(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Para que elegir otra vez el mismo archivo vuelva a avisar.
    input.value = '';
    if (!file || this.restoring) return;

    let backup: Backup;
    try {
      backup = await this.backup.read(file);
    } catch (error) {
      console.error('No se pudo leer la copia de seguridad', error);
      const message = error instanceof BackupError ? error.message : 'No se pudo leer el archivo.';
      this.toast.show(message, { color: 'danger', duration: 5000 });
      return;
    }

    if (!await this.confirmRestore(backup)) return;

    this.restoring = true;
    try {
      await this.backup.restore(backup);
      // Así todas las pantallas (también la lista de temas de Temas) leen los datos restaurados.
      location.reload();
    } catch (error) {
      console.error('No se pudo restaurar la copia de seguridad', error);
      this.toast.show('No se pudo restaurar la copia. Tus datos siguen como estaban.', { color: 'danger', duration: 5000 });
      this.restoring = false;
    }
  }

  private async confirmRestore(backup: Backup): Promise<boolean> {
    const incoming = this.backup.summarize(backup.studySets);
    const date = Date.parse(backup.exportedAt);
    const from = Number.isNaN(date) ? 'La copia' : `La copia del ${dateFormat.format(date)}`;
    const current = this.summary?.topics
      ? ` (${this.count(this.summary.topics, 'tema', 'temas')}, ${this.count(this.summary.words, 'palabra', 'palabras')})`
      : '';
    const alert = await this.alertController.create({
      header: '¿Restaurar la copia?',
      message: `${from} tiene ${this.count(incoming.topics, 'tema', 'temas')} y `
        + `${this.count(incoming.words, 'palabra', 'palabras')}. Reemplazará todo lo que hay en este dispositivo${current}, `
        + 'también tu progreso y tu racha.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Restaurar', role: 'confirm', cssClass: 'alert-button-danger' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  private loadVoices() {
    const voices = this.pronunciation.englishVoices();
    // Android puede repetir el nombre: se numeran.
    const repeated = new Map<string, number>();
    this.voices = voices.map(voice => {
      const label = voiceLabel(voice);
      const count = (repeated.get(label) ?? 0) + 1;
      repeated.set(label, count);
      return { id: voice.voiceURI, label: count > 1 ? `${label} (${count})` : label };
    });
    const best = this.pronunciation.bestVoice();
    this.automaticVoiceLabel = best ? voiceLabel(best) : '';
    // Si la elegida ya no está en el dispositivo (o aún no cargó), suena la automática.
    const chosen = this.pronunciation.voiceId;
    this.voiceId = chosen && this.voices.some(voice => voice.id === chosen) ? chosen : automaticVoice;
  }

  private async loadSummary() {
    this.persistence = await this.storagePersistence.status();
    try {
      this.summary = await this.backup.currentSummary();
    } catch (error) {
      console.error('No se pudo leer lo guardado', error);
      this.summary = null;
    }
  }
}
