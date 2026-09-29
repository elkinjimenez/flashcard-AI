import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ActionSheetController, AlertController, IonButton, IonContent, IonIcon, IonLabel, IonSegment, IonSegmentButton, IonSelect, IonSelectOption,
  IonSpinner, IonToggle
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  clipboardOutline, copyOutline, logoWhatsapp, moonOutline, phonePortraitOutline, refreshOutline, shareOutline,
  sunnyOutline, trashOutline, volumeHighOutline
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
import { Backup, BackupService, BackupSummary } from 'src/app/services/backup';
import { FlashcardService } from 'src/app/services/flashcard';
import { StudySetRepository } from 'src/app/services/study-set-repository';
import { clearSettings } from 'src/app/services/local-setting';
import { forgetWordOfTheDay } from 'src/app/pages/today/word-of-the-day';
import { StoragePersistence, StoragePersistenceService } from 'src/app/services/storage-persistence';
import { ToastService } from 'src/app/services/toast';
import { copyText, sendToWhatsApp, shareText } from 'src/app/services/share-text';
import { AnswerFeedbackService } from 'src/app/services/answer-feedback';
import { count } from 'src/app/services/count';
import { CardModalService } from 'src/app/services/card-modal';
import { ImportBackupComponent } from './import-backup/import-backup.component';

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
// el respaldo, y empezar de cero. Todo se guarda al cambiarlo.
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
  private flashcards = inject(FlashcardService);
  private studySets = inject(StudySetRepository);
  private storagePersistence = inject(StoragePersistenceService);
  private feedback = inject(AnswerFeedbackService);
  private alertController = inject(AlertController);
  private actionSheetController = inject(ActionSheetController);
  private cardModal = inject(CardModalService);
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
  // El mensaje del respaldo, listo antes del toque: iOS solo deja compartir o copiar durante el toque, y comprimir es
  // asíncrono. Se rehace cuando cambia algo de lo que lleva; mientras tanto se queda el anterior.
  backupMessage: string | null = null;
  backupFailed = false;
  sharing = false;
  restoring = false;
  // Reiniciando el progreso o borrando todo.
  resetting = false;

  // Para quedarse solo con el último mensaje si se piden varios seguidos.
  private backupRequest = 0;

  constructor() {
    addIcons({
      clipboardOutline, copyOutline, logoWhatsapp, moonOutline, phonePortraitOutline, refreshOutline, shareOutline,
      sunnyOutline, trashOutline, volumeHighOutline
    });
    this.pronunciation.voicesChanged.pipe(takeUntilDestroyed()).subscribe(() => this.loadVoices());
    this.flashcards.cardsChanged.pipe(takeUntilDestroyed()).subscribe(() => {
      this.prepareBackup();
      this.loadSummary();
    });
  }

  ionViewWillEnter() {
    this.loadVoices();
    this.prepareBackup();
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
    this.prepareBackup();
  }

  setDailyGoal(goal: DailyGoal) {
    this.dailyGoal = goal;
    saveDailyGoal(goal);
    this.prepareBackup();
  }

  setNewWordsLimit(limit: NewWordsLimit) {
    this.newWordsLimit = limit;
    saveNewWordsLimit(limit);
    this.prepareBackup();
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
    this.prepareBackup();
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
    this.prepareBackup();
  }

  // Sin ningún await antes de compartir o copiar: iOS solo lo deja hacer durante el toque.
  async exportBackup() {
    const message = this.backupMessage;
    if (!message) {
      this.toast.show('No se pudo preparar el respaldo.', { color: 'danger' });
      return;
    }
    if (this.sharing) return;

    this.sharing = true;
    const result = await shareText(message);
    this.sharing = false;
    if (result === 'copied') this.showBackupCopied();
    if (result === 'failed') await this.offerBackupOptions(message);
  }

  async importBackup() {
    if (this.restoring) return;

    const backup = await this.cardModal.open<Backup>(ImportBackupComponent);
    if (!backup || !await this.confirmRestore(backup)) return;

    this.restoring = true;
    try {
      await this.backup.restore(backup);
      // Así todas las pantallas (también la lista de temas de Temas) leen los datos restaurados.
      location.reload();
    } catch (error) {
      console.error('No se pudo restaurar el respaldo', error);
      this.toast.show('No se pudo importar el respaldo. Tus datos siguen como estaban.', { color: 'danger', duration: 5000 });
      this.restoring = false;
    }
  }

  // Conserva los temas y las palabras; todo lo demás vuelve a empezar.
  async resetProgress() {
    if (this.resetting) return;
    const confirmed = await this.confirm(
      '¿Reiniciar todo el progreso?',
      `Tus temas y palabras${this.currentAmounts} se mantienen, pero todas volverán a aparecer como nuevas. También se `
        + 'borran tu racha y tus estadísticas. Si quieres poder volver atrás, exporta antes un respaldo.',
      'Reiniciar'
    );
    if (!confirmed) return;

    this.resetting = true;
    try {
      await this.flashcards.resetAllProgress();
      forgetWordOfTheDay();
      // Como al importar: todas las pantallas leen los datos nuevos.
      location.reload();
    } catch (error) {
      console.error('No se pudo reiniciar el progreso', error);
      this.toast.show('No se pudo reiniciar el progreso. Tus datos siguen como estaban.', { color: 'danger', duration: 5000 });
      this.resetting = false;
    }
  }

  // Como recién instalada: los temas de inicio, los ajustes por defecto y la bienvenida.
  async eraseAll() {
    if (this.resetting || !await this.confirmEraseAll()) return;

    this.resetting = true;
    try {
      await this.studySets.eraseAll();
      clearSettings();
      // Al inicio, para que salga la bienvenida.
      location.replace(document.baseURI);
    } catch (error) {
      console.error('No se pudo borrar todo', error);
      this.toast.show('No se pudo borrar todo. Tus datos siguen como estaban.', { color: 'danger', duration: 5000 });
      this.resetting = false;
    }
  }

  private async prepareBackup() {
    const request = ++this.backupRequest;
    try {
      const message = await this.backup.createMessage();
      if (request !== this.backupRequest) return;
      this.backupMessage = message;
      this.backupFailed = false;
    } catch (error) {
      if (request !== this.backupRequest) return;
      console.error('No se pudo preparar el respaldo', error);
      this.backupMessage = null;
      this.backupFailed = true;
    }
  }

  // El primer toque ya no sirve para compartir ni copiar: cada opción es uno nuevo.
  private async offerBackupOptions(message: string) {
    const sheet = await this.actionSheetController.create({
      header: 'Guarda tu respaldo',
      subHeader: 'Envíatelo por WhatsApp o cópialo para pegarlo donde quieras.',
      buttons: [
        { text: 'Enviar por WhatsApp', icon: 'logo-whatsapp', handler: () => sendToWhatsApp(message) },
        { text: 'Copiar respaldo', icon: 'copy-outline', handler: () => { this.copyBackup(message); } },
        { text: 'Cancelar', role: 'cancel' }
      ]
    });
    await sheet.present();
  }

  private async copyBackup(message: string) {
    if (await copyText(message)) this.showBackupCopied();
    else this.toast.show('No se pudo copiar el respaldo.', { color: 'danger' });
  }

  private showBackupCopied() {
    this.toast.show('Respaldo copiado. Pégalo en un chat o en tus notas para guardarlo.');
  }

  private confirmRestore(backup: Backup): Promise<boolean> {
    const incoming = this.backup.summarize(backup.studySets);
    const date = Date.parse(backup.exportedAt);
    const from = Number.isNaN(date) ? 'los del respaldo' : `los del respaldo del ${dateFormat.format(date)}`;
    return this.confirm(
      '¿Importar el respaldo?',
      `Se reemplazarán tus datos${this.currentAmounts} por ${from}: ${this.count(incoming.topics, 'tema', 'temas')} y `
        + `${this.count(incoming.words, 'palabra', 'palabras')}, con su progreso, tu racha y tus ajustes.`,
      'Reemplazar'
    );
  }

  // Lo más destructivo: hay que escribir BORRAR, para que un toque por error no baste.
  private async confirmEraseAll(): Promise<boolean> {
    let confirmed = false;
    const alert = await this.alertController.create({
      header: '¿Borrar todo?',
      message: `Se borrarán tus temas${this.currentAmounts} con su progreso, tu racha, tus estadísticas y tus ajustes: la `
        + 'app quedará como recién instalada. Exporta antes un respaldo si quieres recuperarlos. Para confirmar, escribe '
        + 'BORRAR.',
      inputs: [{
        name: 'text',
        placeholder: 'BORRAR',
        attributes: { spellcheck: false, autocapitalize: 'characters', autocorrect: 'off' }
      }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        {
          text: 'Borrar todo',
          cssClass: 'alert-button-danger',
          handler: ({ text }: { text: string }) => {
            confirmed = text.trim().toUpperCase() === 'BORRAR';
            if (!confirmed) this.toast.show('Escribe BORRAR para confirmar.', { color: 'danger' });
            return confirmed;
          }
        }
      ]
    });
    await alert.present();
    await alert.onDidDismiss();
    return confirmed;
  }

  // Con el botón de confirmar en rojo: todas reemplazan o borran datos.
  private async confirm(header: string, message: string, confirmText: string): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: confirmText, role: 'confirm', cssClass: 'alert-button-danger' }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  // " (3 temas, 120 palabras)"; nada si aún no se sabe o no hay temas.
  private get currentAmounts(): string {
    return this.summary?.topics
      ? ` (${this.count(this.summary.topics, 'tema', 'temas')}, ${this.count(this.summary.words, 'palabra', 'palabras')})`
      : '';
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
