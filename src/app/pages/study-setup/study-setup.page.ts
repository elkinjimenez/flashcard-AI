import { Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonIcon,
  IonSpinner,
  IonActionSheet,
  AlertController
} from '@ionic/angular/standalone';
import {
  checkmark,
  bookmarkOutline,
  sparklesOutline,
  arrowForwardOutline,
  listOutline,
  refresh
} from 'ionicons/icons';
import { registerTopicIcons, topicIcon } from 'src/app/services/topic-icon';
import {
  Flashcard, FlashcardService, NewWordsLimitError, NewWordsToday, TopicProgress, TopicResult
} from 'src/app/services/flashcard';
import { toTopicKey } from 'src/app/services/topic-key';
import { AppUpdateService } from 'src/app/services/app-update';
import { DayChangeService } from 'src/app/services/day-change';
import { EnglishLevel, englishLevelLabel, loadEnglishLevel } from 'src/app/services/english-level';
import { describeRequestError } from 'src/app/services/request-error';
import { ToastService } from 'src/app/services/toast';

interface Topic {
  id: string;
  label: string;
  icon: string;
  fromLocal: boolean;
  progress?: TopicProgress;
}

@Component({
  selector: 'app-study-setup',
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonButton,
    IonIcon,
    IonSpinner,
    IonActionSheet,
    FormsModule
  ],
  templateUrl: './study-setup.page.html',
  styleUrls: ['./study-setup.page.scss'],
})
export class StudySetupPage implements OnInit {
  private router = inject(Router);
  private flashcardService = inject(FlashcardService);
  private alertController = inject(AlertController);
  private appUpdate = inject(AppUpdateService);
  private toast = inject(ToastService);

  topics: Topic[] = [];
  loadingTopics = true;
  // Qué puede hacer el usuario (ver describeRequestError); null si no hubo error. Los demás errores van en un toast.
  topicsError: string | null = null;
  loadingMoreTopics = false;
  // Qué se está preparando: practicar el tema o pedir palabras nuevas.
  loadingCards: 'practice' | 'new-words' | null = null;
  topicMenuOpen = false;
  menuTopic: Topic | null = null;
  private topicPressTimer?: ReturnType<typeof setTimeout>;
  private topicPressStart = { x: 0, y: 0 };
  private ignoreNextTopicClick = false;

  selectedTopic: string | null = null;
  cardCount: number = 10;
  // Se elige en Ajustes: se vuelve a leer en cada visita.
  level: EnglishLevel = loadEnglishLevel();
  // Las palabras nuevas de hoy frente al tope de Ajustes; null mientras se lee o si falla.
  newWords: NewWordsToday | null = null;

  constructor() {
    addIcons({ checkmark, bookmarkOutline, sparklesOutline, arrowForwardOutline, listOutline, refresh });
    registerTopicIcons();
    merge(this.flashcardService.cardsChanged, inject(DayChangeService).dayChanged)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.ionViewWillEnter());
  }

  async ngOnInit() {
    try {
      const result: TopicResult = await this.flashcardService.getTopics();
      if (!result.topics.length) {
        throw new Error('Gemini no devolvio temas');
      }
      this.topics = result.topics.map(label => ({
        id: toTopicKey(label),
        label,
        icon: topicIcon(label),
        fromLocal: result.fromLocal
      }));
      await this.refreshProgress();
    } catch (error) {
      console.error('No se pudieron cargar los temas de Gemini', error);
      this.topicsError = describeRequestError(error);
    } finally {
      this.loadingTopics = false;
    }
  }

  // Al volver a la pestaña, al terminar una sesión o al empezar un día nuevo, el progreso (y los temas recién guardados)
  // cambian. También las palabras nuevas que quedan hoy, y el tope si se cambió en Ajustes.
  async ionViewWillEnter() {
    this.level = loadEnglishLevel();
    if (!this.loadingTopics && this.topics.length) {
      await this.refreshProgress();
    }
  }

  private async refreshProgress() {
    try {
      const [progress, newWords] = await Promise.all([
        this.flashcardService.getTopicsProgress(),
        this.flashcardService.newWordsToday()
      ]);
      this.newWords = newWords;
      this.topics = this.topics.map(topic => {
        const topicProgress = progress.get(topic.id);
        return { ...topic, progress: topicProgress, fromLocal: topic.fromLocal || !!topicProgress };
      });
    } catch (error) {
      console.error('No se pudo cargar el progreso de los temas', error);
    }
  }

  get levelLabel(): string {
    return englishLevelLabel(this.level);
  }

  topicAriaLabel(topic: Topic): string {
    const parts = [topic.label];
    if (topic.progress) {
      parts.push(`avance ${topic.progress.percent} %`, `ya sabes ${topic.progress.known} de ${topic.progress.total} palabras`);
    }
    parts.push(topic.fromLocal ? 'tema guardado' : 'tema nuevo de la IA');
    return parts.join(', ');
  }

  selectTopic(topicId: string) {
    if (this.ignoreNextTopicClick) {
      this.ignoreNextTopicClick = false;
      return;
    }
    this.selectedTopic = this.selectedTopic === topicId ? null : topicId;
  }

  startTopicPress(topic: Topic, event: PointerEvent) {
    this.cancelTopicPress();
    if (!topic.fromLocal) return;

    this.topicPressStart = { x: event.clientX, y: event.clientY };
    this.topicPressTimer = setTimeout(() => {
      this.ignoreNextTopicClick = true;
      this.menuTopic = topic;
      this.topicMenuOpen = true;
    }, 600);
  }

  cancelTopicPress() {
    if (this.topicPressTimer) {
      clearTimeout(this.topicPressTimer);
      this.topicPressTimer = undefined;
    }
  }

  // Si el dedo se mueve (p. ej. al deslizar entre pestañas, que arrastra la tarjeta con él), no es una pulsación larga.
  moveTopicPress(event: PointerEvent) {
    if (this.topicPressTimer && Math.hypot(event.clientX - this.topicPressStart.x, event.clientY - this.topicPressStart.y) > 10) {
      this.cancelTopicPress();
    }
  }

  // Clic derecho, tecla Menú o Mayús+F10 sobre un tema guardado: el mismo menú que la pulsación larga.
  openTopicMenu(topic: Topic, event: Event) {
    if (!topic.fromLocal) return;
    event.preventDefault();
    this.cancelTopicPress();
    this.menuTopic = topic;
    this.topicMenuOpen = true;
  }

  closeTopicMenu() {
    this.topicMenuOpen = false;
    this.menuTopic = null;
    // Tras la pulsación larga el click puede no llegar a la tarjeta (el menú la tapa); sin esto se perdería el siguiente toque.
    this.ignoreNextTopicClick = false;
  }

  async deleteSelectedTopic() {
    const topic = this.menuTopic;
    this.closeTopicMenu();
    if (topic) await this.deleteTopic(topic);
  }

  showSelectedTopicWords() {
    const topic = this.menuTopic;
    this.closeTopicMenu();
    if (topic) this.showWords(topic);
  }

  // Pantalla completa, como la práctica. Lo que se cambie allí llega aquí por cardsChanged.
  showWords(topic: Topic) {
    this.router.navigate(['/topic-words', topic.id], { state: { returnUrl: '/tabs/topics' } });
  }

  async resetSelectedTopic() {
    const topic = this.menuTopic;
    this.closeTopicMenu();
    if (topic) await this.resetTopic(topic);
  }

  async resetTopic(topic: Topic) {
    const confirmed = await this.confirmAction(
      '¿Reiniciar el progreso?',
      `Las palabras de "${topic.label}" se mantienen, pero volverán a aparecer como nuevas.`,
      'Reiniciar'
    );
    if (!confirmed) return;

    try {
      await this.flashcardService.resetTopic(topic.label);
      await this.refreshProgress();
    } catch (error) {
      console.error('No se pudo reiniciar el tema', error);
    }
  }

  async deleteTopic(topic: Topic) {
    const confirmed = await this.confirmAction(
      '¿Eliminar el tema?',
      `Se borrarán "${topic.label}" y sus tarjetas guardadas, con todo su progreso.`,
      'Eliminar',
      true
    );
    if (!confirmed) return;

    try {
      await this.flashcardService.deleteTopic(topic.label);
      this.topics = this.topics.filter(item => item.id !== topic.id);
      if (this.selectedTopic === topic.id) {
        this.selectedTopic = null;
      }
      if (this.topics.length === 0) {
        this.loadingTopics = true;
        this.topicsError = null;
        try {
          await this.loadMoreTopics();
        } finally {
          this.loadingTopics = false;
        }
      }
    } catch (error) {
      console.error('No se pudo eliminar el tema', error);
    }
  }

  // ion-alert en lugar de confirm(): el diálogo nativo del navegador desentona con el resto de la app.
  private async confirmAction(header: string, message: string, confirmText: string, destructive = false): Promise<boolean> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: confirmText, role: 'confirm', cssClass: destructive ? 'alert-button-danger' : undefined }
      ]
    });
    await alert.present();
    const { role } = await alert.onDidDismiss();
    return role === 'confirm';
  }

  // En la PWA instalada no hay botón de recargar del navegador. Si hay versión nueva, entra con ella.
  reload() {
    this.appUpdate.updateAndReload();
  }

  async loadMoreTopics() {
    if (this.loadingMoreTopics) return;

    this.loadingMoreTopics = true;

    try {
      const labels = await this.flashcardService.getMoreTopics(this.topics.map(topic => topic.label));
      const localTopics = this.topics.filter(topic => topic.fromLocal);
      const suggestedTopics = labels.map(label => ({
        id: toTopicKey(label),
        label,
        icon: topicIcon(label),
        fromLocal: false
      }));

      this.topics = [...localTopics, ...suggestedTopics];
      if (this.selectedTopic && !this.topics.some(topic => topic.id === this.selectedTopic)) {
        this.selectedTopic = null;
      }
    } catch (error) {
      console.error('No se pudieron cargar más temas de Gemini', error);
      this.showRequestError('No se pudieron cargar más temas.', error);
    } finally {
      this.loadingMoreTopics = false;
    }
  }

  // El tema elegido, si está guardado: se practica con sus palabras y las nuevas se piden aparte.
  get selectedSavedTopic(): Topic | undefined {
    const topic = this.topics.find(item => item.id === this.selectedTopic);
    return topic?.progress ? topic : undefined;
  }

  // Ya no se pueden empezar palabras nuevas hoy.
  get newWordsLimitReached(): boolean {
    return this.newWords?.left === 0;
  }

  // Las que pide el botón de añadir: las elegidas, como mucho las que quedan del tope.
  get newWordsCount(): number {
    return Math.min(this.cardCount, this.newWords?.left ?? this.cardCount);
  }

  // Ya se sabe todas, o solo le quedan nuevas y ya se llegó al tope.
  get nothingToPractice(): boolean {
    const progress = this.selectedSavedTopic?.progress;
    return !!progress && (progress.pending === 0 || (this.newWordsLimitReached && progress.pending === progress.newWords));
  }

  // Un tema nuevo se crea con palabras nuevas: con el tope alcanzado no se puede.
  get cannotStart(): boolean {
    return !this.selectedTopic || this.nothingToPractice || (!this.selectedSavedTopic && this.newWordsLimitReached);
  }

  get sessionHint(): string | null {
    if (!this.selectedTopic) return null;
    const newWords = this.newWords;
    if (this.selectedSavedTopic?.progress?.pending === 0 && !this.newWordsLimitReached) {
      return 'Ya sabes todas las palabras de este tema y volverán cuando toque repasarlas. Añade nuevas para seguir.';
    }
    if (newWords && !newWords.left) {
      return `Hoy ya empezaste tus ${newWords.limit} palabras nuevas: ahora toca repasar. Mañana podrás empezar más `
        + '(el tope se cambia en Ajustes).';
    }
    if (newWords && newWords.left < this.cardCount) {
      return `Hoy puedes empezar ${newWords.left} palabras nuevas más: tu tope diario es de ${newWords.limit}.`;
    }
    return null;
  }

  // Con un tema guardado no consulta a la IA; con uno nuevo lo crea.
  startStudy() {
    return this.openSession('practice', topic => this.flashcardService.prepareSession(topic, this.cardCount, this.level));
  }

  addNewWords() {
    return this.openSession('new-words', topic => this.flashcardService.addWords(topic, this.newWordsCount, this.level));
  }

  private async openSession(mode: 'practice' | 'new-words', load: (topic: string) => Promise<Flashcard[]>) {
    const topic = this.topics.find(item => item.id === this.selectedTopic);
    if (!topic || this.loadingCards) return;

    this.loadingCards = mode;

    try {
      const cards = await load(topic.label);
      if (!cards.length) {
        // Ya se sabe todas o llegó al tope de nuevas: con el progreso al día, sessionHint lo explica.
        await this.refreshProgress();
        return;
      }
      await this.router.navigate(['/flashcards'], { state: { topic: topic.label, cards, returnUrl: '/tabs/topics' } });
    } catch (error) {
      if (error instanceof NewWordsLimitError) {
        this.toast.show(error.message, { duration: 5000 });
        await this.refreshProgress();
        return;
      }
      console.error('No se pudieron generar las tarjetas', error);
      this.showRequestError('No se pudieron generar las tarjetas.', error);
    } finally {
      this.loadingCards = null;
    }
  }

  // Más largo que el toast por defecto: son dos frases.
  private showRequestError(message: string, error: unknown) {
    this.toast.show(`${message} ${describeRequestError(error)}`, { color: 'danger', duration: 5000 });
  }

}
