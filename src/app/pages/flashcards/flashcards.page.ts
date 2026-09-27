import { Component, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonProgressBar, IonSpinner, ModalController, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  volumeHighOutline, arrowBackOutline, imageOutline, imagesOutline, eyeOutline, eyeOffOutline, bulbOutline
} from 'ionicons/icons';
import { AnswerRecord, Flashcard, FlashcardService } from 'src/app/services/flashcard';
import { isNewCard, mnemonicMisses } from 'src/app/services/flashcard.model';
import { SessionSummary, SessionSummaryComponent, SummaryWord } from './session-summary/session-summary.component';
import { QuizCardComponent, QuizKind } from './quiz-card/quiz-card.component';
import { SpeakCardComponent, SpeechUnavailableReason } from './speak-card/speak-card.component';
import { IntroCardComponent } from './intro-card/intro-card.component';
import { WriteAnswer, WriteCardComponent } from './write-card/write-card.component';
import { ImagePickerComponent } from './image-picker/image-picker.component';
import { ActionBarComponent, ActionMode } from './action-bar/action-bar.component';
import { SpeechRecognitionService } from 'src/app/services/speech-recognition';
import { isSameWord, wordPattern } from 'src/app/services/word-forms';
import { ToastService } from 'src/app/services/toast';
import { PronunciationService } from 'src/app/services/pronunciation';
import { StatsService, Streak } from 'src/app/services/stats';

// Los que se sortean. speak: ver la imagen y decir la palabra en voz alta. write: verla y escribirla.
type DrawnExercise = 'card' | QuizKind | 'speak' | 'write';
// intro: presentar una palabra nueva, sin preguntar.
type ExerciseKind = DrawnExercise | 'intro';

// Qué se le pide a una palabra según su caja de Leitner, de más fácil a más difícil: reconocer qué significa (0-1),
// recordar cómo se dice con ayuda (2-3) y producirla de memoria (4 en adelante, también en los repasos de mantenimiento
// de las aprendidas). Así, para aprenderla hay que pasar por todas.
type Stage = 'recognize' | 'recall' | 'produce';

function stageOf(card: Flashcard): Stage {
  const box = card.box ?? 0;
  return box <= 1 ? 'recognize' : box <= 3 ? 'recall' : 'produce';
}

// Tarjetas entre la presentación de una palabra nueva y su primer ejercicio: así hay que recordarla, no solo repetirla.
const introGap = 3;

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Orden de la sesión: cada palabra nueva sale dos veces, primero presentada y `introGap` tarjetas después en un ejercicio.
// intros: posiciones de las presentaciones.
function planSession(sessionCards: Flashcard[]): { cards: Flashcard[]; intros: Set<number> } {
  const cards: Flashcard[] = [];
  const intros = new Set<number>();
  // Presentadas que esperan su ejercicio, con la posición desde la que les toca.
  const waiting: { card: Flashcard; at: number }[] = [];
  const addWaiting = () => {
    while (waiting.length && waiting[0].at <= cards.length) {
      cards.push(waiting.shift()!.card);
    }
  };

  for (const card of shuffle(sessionCards)) {
    addWaiting();
    if (isNewCard(card)) {
      intros.add(cards.length);
      waiting.push({ card, at: cards.length + 1 + introGap });
    }
    cards.push(card);
  }
  // Al final no quedan tarjetas con que separarlas: van seguidas.
  cards.push(...waiting.map(item => item.card));
  return { cards, intros };
}

// Tarjetas entre el fallo de una palabra y su repetición (de 3 a 5, al azar): pronto, cuando recordarla aún cuesta
// un poco, que es lo que más la fija.
const minRetryGap = 3;
const maxRetryGap = 5;

// Lo que se hizo con una tarjeta, con lo necesario para deshacerlo.
interface SessionStep {
  index: number;
  card: Flashcard;
  knew: boolean;
  previousResult?: 'knew' | 'hard';
  // La respuesta guardada; undefined si no se pudo guardar.
  saved?: Promise<AnswerRecord | undefined>;
  // Si falló, dónde se metió su repetición.
  retryAt?: number;
  // "Ya la conozco": dónde estaba su ejercicio, que se quitó.
  skippedAt?: number;
}

@Component({
  selector: 'app-flashcards',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonButtons,
    IonButton, IonIcon,
    IonProgressBar,
    IonSpinner,
    SessionSummaryComponent,
    QuizCardComponent,
    SpeakCardComponent,
    IntroCardComponent,
    WriteCardComponent,
    ActionBarComponent
  ],
  templateUrl: './flashcards.page.html',
  styleUrls: ['./flashcards.page.scss'],
})
export class FlashcardsPage {
  private router = inject(Router);
  private flashcardService = inject(FlashcardService);
  private toast = inject(ToastService);
  private speech = inject(SpeechRecognitionService);
  private modalController = inject(ModalController);
  private navController = inject(NavController);
  private pronunciation = inject(PronunciationService);
  private statsService = inject(StatsService);

  cards: Flashcard[] = [];
  currentIndex = 0;
  isFlipped = false;
  // Al cambiar de tarjeta el giro al frente es instantáneo: animado, se vería la palabra de la siguiente.
  instantFlip = false;
  // La traducción queda oculta hasta que se pide: se aprende por la imagen, no traduciendo.
  showTranslation = false;
  // Continuar: la tarjeta sale hacia arriba y la nueva entra desde detrás; volver atrás hace lo contrario.
  cardMotion: 'leave' | 'enter' | 'leave-back' | 'enter-back' | null = null;
  loading = true;
  loadingError = false;
  imageLoaded = false;
  imageFailed = false;
  summary: SessionSummary | null = null;
  // Ejercicio de la tarjeta actual.
  exercise: ExerciseKind = 'card';
  // Sube en cada aparición de una tarjeta: los ejercicios de hablar y escribir se reinician con él.
  exerciseRound = 0;
  // En el de hablar, si se pueden pedir pistas: no cuando toca producir la palabra (ver stageOf).
  speakHints = true;
  // Truco para recordar la palabra recién fallada, si ya cuesta (ver showMnemonic); null si no hay.
  mnemonic: string | null = null;
  // La IA lo está creando.
  creatingMnemonic = false;
  // La correcta y hasta 3 palabras más del tema, en orden aleatorio.
  quizOptions: Flashcard[] = [];
  quizChoice: Flashcard | null = null;
  // Resultado del ejercicio actual (opción múltiple o habla); null mientras no se responde.
  exerciseResult: boolean | null = null;
  // Tras acertar se avanza solo pasado este tiempo, y el botón Continuar se va llenando; 0: espera al botón.
  autoAdvanceMs = 0;
  // Todas las palabras del tema (también las aprendidas), de donde salen las opciones incorrectas.
  private topicCards: Flashcard[] = [];
  // Posiciones de `cards` que presentan una palabra nueva (ver planSession). Se desplazan al meter o quitar la
  // repetición de una difícil (ver insertCard).
  private introIndexes = new Set<number>();
  private lastExercise: ExerciseKind | null = null;
  // Sin micrófono o sin permiso, el ejercicio de habla deja de salir en la sesión.
  private speechBlocked = false;
  // Si ahora no puede escuchar, tampoco sale el de escuchar.
  private listeningDeclined = false;
  private quizTimer?: ReturnType<typeof setTimeout>;
  // Resultado de cada palabra en la sesión; 'hard' si se marcó difícil al menos una vez.
  private sessionResults = new Map<string, 'knew' | 'hard'>();
  private steps: SessionStep[] = [];
  // Las escrituras van en fila: deshacer debe restaurar después de que se guardó la respuesta y antes de la siguiente.
  private saveQueue: Promise<unknown> = Promise.resolve();
  // Racha al empezar: el resumen dice si la sesión le sumó un día o batió el récord. undefined si no se pudo leer.
  private streakAtStart?: Streak;
  topic = '';
  // Pestaña a la que se vuelve al salir (la que abrió la sesión).
  private returnUrl = '/tabs/topics';
  dragX = 0;
  dragY = 0;
  isDragging = false;
  private answering = false;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private readonly SWIPE_THRESHOLD = 100;
  // Voz automática al voltear la tarjeta o al aparecer el ejercicio de escuchar.
  private autoSpeakTimer?: ReturnType<typeof setTimeout>;
  @ViewChild(SpeakCardComponent) private speakCard?: SpeakCardComponent;
  @ViewChild(WriteCardComponent) private writeCard?: WriteCardComponent;

  constructor() {
    addIcons({ volumeHighOutline, arrowBackOutline, imageOutline, imagesOutline, eyeOutline, eyeOffOutline, bulbOutline });
  }

  // Única carga de la sesión: Ionic llama a este hook cada vez que se entra en la página, también la primera.
  async ionViewWillEnter() {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state; // fallback si se recarga la página

    const topic = state?.['topic'] as string | undefined;
    // Las elige la pestaña de la que se viene (repasos del tema o palabras recién añadidas), adonde se vuelve al salir.
    const sessionCards = (state?.['cards'] ?? []) as Flashcard[];
    this.returnUrl = state?.['returnUrl'] ?? '/tabs/topics';

    if (!topic || !sessionCards.length) {
      await this.router.navigate([this.returnUrl]);
      return;
    }

    this.topic = topic;
    this.loading = true;
    this.loadingError = false;
    this.currentIndex = 0;
    this.isFlipped = false;
    this.showTranslation = false;
    this.imageLoaded = false;
    this.imageFailed = false;
    this.summary = null;
    this.cardMotion = null;
    this.sessionResults.clear();
    this.steps = [];
    this.streakAtStart = undefined;
    this.statsService.getStreak()
      .then(streak => this.streakAtStart = streak)
      .catch(error => console.warn('No se pudo leer la racha', error));

    try {
      const plan = planSession(sessionCards);
      this.cards = plan.cards;
      this.introIndexes = plan.intros;
      this.topicCards = await this.flashcardService.getTopicCards(topic);
      this.lastExercise = null;
      this.prepareExercise();
    } catch (error) {
      console.error('No se pudieron recuperar las tarjetas', error);
      this.loadingError = true;
    } finally {
      this.loading = false;
    }
  }

  get currentCard(): Flashcard | undefined {
    return this.cards[this.currentIndex];
  }

  get progress(): number {
    return this.cards.length ? (this.currentIndex + 1) / this.cards.length : 0;
  }

  get cardTransform(): string {
    if (this.dragX === 0 && this.dragY === 0) return '';
    const rotation = this.dragX * 0.05;
    return `translate(${this.dragX}px, ${this.dragY}px) rotate(${rotation}deg)`;
  }

  get imageUnavailable(): boolean {
    return !this.currentCard?.imageUrl || this.imageFailed;
  }

  // Frase de ejemplo partida para resaltar la palabra: los trozos en posición impar son la palabra.
  get exampleParts(): string[] {
    const card = this.currentCard;
    return card?.example ? card.example.split(wordPattern(card.word)) : [];
  }

  // En el frente no se nombra la palabra (sería darle la respuesta al lector de pantalla), salvo si no hay imagen.
  get cardAriaLabel(): string {
    const card = this.currentCard;
    if (!card) return '';
    if (!this.isFlipped) {
      return this.imageUnavailable ? card.word : 'Adivina la palabra de la imagen';
    }
    return [card.word, card.example, this.showTranslation ? card.translation : '']
      .filter(Boolean)
      .join(': ');
  }

  // Solo con la palabra a la vista: el selector la muestra, así que antes delataría la respuesta.
  get canChangeImage(): boolean {
    if (this.loading || this.loadingError || this.summary || !this.currentCard) return false;
    if (this.exercise === 'intro') return true;
    return this.exercise === 'card' ? this.isFlipped || this.imageUnavailable : this.exerciseAnswered;
  }

  get canUndo(): boolean {
    return this.steps.length > 0;
  }

  get quizKind(): QuizKind | null {
    return this.exercise === 'pick-image' || this.exercise === 'pick-word' || this.exercise === 'listen'
      ? this.exercise
      : null;
  }

  get exerciseAnswered(): boolean {
    return this.exerciseResult !== null;
  }

  get actionMode(): ActionMode {
    // En la presentación no hay nada que responder.
    if (this.exerciseAnswered || this.exercise === 'intro') return 'continue';
    if (this.exercise !== 'card') return 'give-up';
    return this.isFlipped ? 'rate' : 'flip';
  }

  get cardHint(): string {
    return this.isFlipped ? 'Desliza: ← Difícil · La sé →' : 'Toca la tarjeta para darle la vuelta';
  }

  get swipeDirection(): 'left' | 'right' | null {
    if (!this.isDragging || Math.abs(this.dragX) < 40) return null;
    return this.dragX > 0 ? 'right' : 'left';
  }

  onPointerDown(event: PointerEvent) {
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.dragX = 0;
    this.dragY = 0;
    this.isDragging = true;
    this.startTime = Date.now();
  }

  onPointerMove(event: PointerEvent) {
    if (!this.isDragging) return;
    this.dragX = event.clientX - this.startX;
    this.dragY = event.clientY - this.startY;
  }

  onPointerUp() {
    if (!this.isDragging) return;

    const elapsed = Date.now() - this.startTime;
    const distance = Math.abs(this.dragX);
    this.isDragging = false;

    if (distance < 10 && elapsed < 300) {
      this.dragX = 0;
      this.dragY = 0;
      this.flip();
      return;
    }

    if (distance > this.SWIPE_THRESHOLD) {
      this.answer(this.dragX > 0);
    } else {
      this.dragX = 0;
      this.dragY = 0;
    }
  }

  onCardKeydown(event: KeyboardEvent) {
    // Solo con el foco en la tarjeta, no en el botón de pronunciación que tiene dentro.
    if (event.target !== event.currentTarget) return;

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.flip();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      this.answer(event.key === 'ArrowRight');
    }
  }

  // Respuesta de la tarjeta (deslizando, con las flechas o con Difícil / La sé): sale animada y se pasa a la siguiente.
  answer(knew: boolean) {
    const card = this.currentCard;
    // Evita responder dos veces la misma tarjeta (p. ej. al mantener pulsada una flecha).
    if (!card || this.answering) return;

    this.answering = true;
    this.dragX = knew ? 500 : -500;
    this.registerAnswer(card, knew);

    setTimeout(() => {
      this.dragX = 0;
      this.dragY = 0;
      this.answering = false;
      this.next();
      this.cardMotion = this.summary ? null : 'enter';
    }, 250);
  }

  chooseQuizOption(option: Flashcard) {
    const card = this.currentCard;
    if (!card || this.exerciseAnswered || this.answering) return;

    this.quizChoice = option;
    this.finishExercise(option.word === card.word);
  }

  onSpeakAnswered(knew: boolean) {
    this.finishExercise(knew);
  }

  // Tras fallar una palabra que ya cuesta (ver mnemonicMisses), su truco para recordarla: el guardado o uno nuevo de la
  // IA. Con el progreso guardado, que dice cuántas veces se ha fallado. Solo mientras siga en pantalla ese ejercicio.
  private async showMnemonic(saved?: Promise<AnswerRecord | undefined>) {
    const round = this.exerciseRound;
    const topic = this.topic;
    const previous = (await saved)?.previous;
    if (!previous || (previous.misses ?? 0) + 1 < mnemonicMisses || round !== this.exerciseRound) return;

    this.creatingMnemonic = previous.mnemonic === undefined;
    try {
      const mnemonic = await this.flashcardService.getMnemonic(topic, previous);
      if (round === this.exerciseRound) {
        this.mnemonic = mnemonic || null;
      }
    } catch (error) {
      // Sin truco (p. ej. sin conexión): se pedirá en el próximo fallo.
      console.warn('No se pudo crear el truco para recordarla', error);
    } finally {
      if (round === this.exerciseRound) {
        this.creatingMnemonic = false;
      }
    }
  }

  // Si valió con una errata u otra forma de la palabra, espera a Continuar: que vea cómo se escribe.
  onWriteAnswered({ knew, corrected }: WriteAnswer) {
    this.finishExercise(knew, !corrected);
  }

  // No lo sé: cuenta como fallo y muestra la respuesta. En los de hablar y escribir la muestra el propio ejercicio,
  // que avisa con answered.
  giveUp() {
    if (this.exercise === 'speak') {
      this.speakCard?.giveUp();
    } else if (this.exercise === 'write') {
      this.writeCard?.giveUp();
    } else {
      this.finishExercise(false);
    }
  }

  // Acertar cuenta como La sé y fallar como Difícil. Si acierta pasa sola (salvo con autoAdvance a false); si falla
  // espera a Continuar, para que vea cuál era.
  private finishExercise(knew: boolean, autoAdvance = true) {
    const card = this.currentCard;
    if (!card || this.exerciseAnswered || this.answering) return;

    this.exerciseResult = knew;
    const step = this.registerAnswer(card, knew);
    this.speak(card.word);
    if (!knew) {
      this.showMnemonic(step.saved);
    }

    // Eligiendo imagen espera más: tras responder, cada imagen muestra su palabra y da tiempo a leerlas.
    const pickedImage = this.exercise === 'pick-image' || this.exercise === 'listen';
    const produced = this.exercise === 'speak' || this.exercise === 'write';
    this.autoAdvanceMs = !knew || !autoAdvance ? 0 : pickedImage ? 3000 : produced ? 1500 : 1000;
    if (this.autoAdvanceMs) {
      this.advanceAfter(this.autoAdvanceMs);
    }
  }

  // Sin micrófono, o si ahora no puede hablar: los ejercicios de voz dejan de salir y esta tarjeta cambia de ejercicio.
  onSpeechUnavailable(reason: SpeechUnavailableReason) {
    this.speechBlocked = true;
    if (this.exercise !== 'speak' || this.exerciseAnswered) return;

    this.prepareExercise();
    this.cardMotion = 'enter';
    this.showToast(reason === 'blocked'
      ? 'No hay acceso al micrófono: seguimos sin ejercicios de voz.'
      : 'Vale, seguimos sin ejercicios de voz en esta sesión.', 'dark');
  }

  // Ahora no puede escuchar: el ejercicio de escuchar deja de salir y esta tarjeta cambia de ejercicio.
  onListeningDeclined() {
    this.listeningDeclined = true;
    if (this.exercise !== 'listen' || this.exerciseAnswered) return;

    this.prepareExercise();
    this.cardMotion = 'enter';
    this.showToast('Vale, seguimos sin ejercicios de escuchar en esta sesión.', 'dark');
  }

  // La imagen de la que depende el ejercicio no cargó: no se podría responder, así que pasa a tarjeta normal
  // (que sin imagen muestra la palabra).
  onExerciseImageError() {
    if (this.exerciseAnswered) return;
    this.exercise = 'card';
    this.lastExercise = 'card';
    this.quizOptions = [];
    this.imageFailed = true;
  }

  async changeImage() {
    const card = this.currentCard;
    if (!card || this.answering) return;

    // Mientras elige no se avanza solo: tras cambiarla, seguirá con Continuar.
    this.clearQuizTimer();
    this.autoAdvanceMs = 0;

    const modal = await this.modalController.create({ component: ImagePickerComponent, componentProps: { card } });
    await modal.present();
    const { data: imageUrl, role } = await modal.onWillDismiss<string>();
    if (role !== 'confirm' || !imageUrl || imageUrl === card.imageUrl) return;

    this.replaceImage(card.word, imageUrl);
    const topic = this.topic;
    this.enqueueSave(async () => {
      try {
        await this.flashcardService.changeImage(topic, card.word, imageUrl);
        this.showToast('Imagen actualizada.', 'dark');
      } catch (error) {
        console.error('No se pudo guardar la imagen', error);
        this.showError(`No se pudo guardar la imagen de "${card.word}".`);
      }
    });
  }

  // En todas las copias de la tarjeta en la sesión (las difíciles se repiten) y en las opciones de los ejercicios.
  private replaceImage(word: string, imageUrl: string) {
    const update = (card: Flashcard) => card.word === word ? { ...card, imageUrl } : card;
    this.cards = this.cards.map(update);
    this.topicCards = this.topicCards.map(update);
    this.quizOptions = this.quizOptions.map(update);
    this.imageLoaded = false;
    this.imageFailed = false;
  }

  private advanceAfter(delayMs: number) {
    this.quizTimer = setTimeout(() => {
      this.quizTimer = undefined;
      this.advance();
    }, delayMs);
  }

  // Ya la conocía (en su presentación): salta a una caja alta y se quita su ejercicio de la sesión. En el resumen
  // cuenta como La sé.
  markKnown() {
    const card = this.currentCard;
    if (!card || this.exercise !== 'intro' || this.answering) return;

    const step = this.registerAnswer(card, true, topic => this.flashcardService.markKnown(topic, card.word));
    // Por palabra: cambiar la imagen crea copias nuevas de la tarjeta. Detrás de la presentación solo está su ejercicio.
    const skippedAt = this.cards.findIndex((other, index) => index > this.currentIndex && other.word === card.word);
    if (skippedAt >= 0) {
      step.skippedAt = skippedAt;
      this.removeCard(skippedAt);
    }
    this.showToast(`«${card.word}» pasa a tus repasos: volverá en unas semanas para comprobarlo.`, 'dark');
    this.advance();
  }

  // Guarda la respuesta (por defecto, la de un ejercicio) y la apunta en la sesión y en el historial para poder deshacerla.
  private registerAnswer(
    card: Flashcard,
    knew: boolean,
    save = (topic: string) => this.flashcardService.recordAnswer(topic, card.word, knew)
  ): SessionStep {
    const step: SessionStep = {
      index: this.currentIndex,
      card,
      knew,
      previousResult: this.sessionResults.get(card.word),
      saved: this.saveAnswer(card, save)
    };
    this.steps.push(step);
    if (knew) {
      if (!this.sessionResults.has(card.word)) {
        this.sessionResults.set(card.word, 'knew');
      }
    } else {
      this.sessionResults.set(card.word, 'hard');
      // La difícil se repite unas tarjetas después (al final, si quedan menos), en la caja 0 como queda guardada: vuelve
      // a los ejercicios de reconocer (ver stageOf). reviewHardCards se queda con esta copia, la última de cada palabra.
      const gap = minRetryGap + Math.floor(Math.random() * (maxRetryGap - minRetryGap + 1));
      step.retryAt = Math.min(this.currentIndex + 1 + gap, this.cards.length);
      this.insertCard(step.retryAt, { ...card, box: 0 });
    }
    return step;
  }

  // Las presentaciones que quedan detrás se desplazan con ella.
  private insertCard(position: number, card: Flashcard) {
    this.cards.splice(position, 0, card);
    this.introIndexes = new Set([...this.introIndexes].map(index => index >= position ? index + 1 : index));
  }

  private removeCard(position: number) {
    this.cards.splice(position, 1);
    this.introIndexes = new Set([...this.introIndexes].map(index => index > position ? index - 1 : index));
  }

  // Continuar tras un ejercicio respondido (la respuesta ya está en el historial) o tras una presentación.
  advance() {
    if (this.answering) return;

    this.clearQuizTimer();
    this.answering = true;
    this.cardMotion = 'leave';
    setTimeout(() => {
      this.answering = false;
      this.next();
      this.cardMotion = this.summary ? null : 'enter';
    }, 250);
  }

  // Vuelve a la tarjeta anterior y deshace su respuesta (La sé o Difícil).
  undo() {
    const step = this.steps[this.steps.length - 1];
    if (!step || this.answering) return;
    this.steps.pop();
    this.clearQuizTimer();

    // Desde el resumen no hay tarjeta que retirar.
    if (this.summary) {
      this.revertStep(step);
      return;
    }

    this.answering = true;
    this.cardMotion = 'leave-back';
    setTimeout(() => {
      this.answering = false;
      this.revertStep(step);
    }, 250);
  }

  // Solo la animación de la propia tarjeta: las de los sellos de Difícil / La sé también llegan aquí.
  onCardAnimationEnd(event: AnimationEvent) {
    if (event.target === event.currentTarget && (this.cardMotion === 'enter' || this.cardMotion === 'enter-back')) {
      this.cardMotion = null;
    }
  }

  private revertStep(step: SessionStep) {
    this.summary = null;
    this.clearAutoSpeakTimer();
    this.moveTo(step.index);
    this.cardMotion = 'enter-back';

    if (step.previousResult) {
      this.sessionResults.set(step.card.word, step.previousResult);
    } else {
      this.sessionResults.delete(step.card.word);
    }
    // Se quita la repetición de la difícil después de moverse: moveTo compara con la tarjeta actual. Sigue en retryAt: las
    // que se metieron después ya se quitaron al deshacer sus pasos, que van antes.
    if (step.retryAt !== undefined) {
      this.removeCard(step.retryAt);
    }
    // "Ya la conozco": vuelve su ejercicio.
    if (step.skippedAt !== undefined) {
      this.insertCard(step.skippedAt, step.card);
    }
    this.undoSavedAnswer(step.saved);
  }

  // No se espera desde el swipe para no frenar la animación; los errores se avisan aquí.
  private saveAnswer(
    card: Flashcard,
    save: (topic: string) => Promise<AnswerRecord | undefined>
  ): Promise<AnswerRecord | undefined> {
    const topic = this.topic;
    return this.enqueueSave(async () => {
      try {
        return await save(topic);
      } catch (error) {
        console.error('No se pudo guardar la respuesta', error);
        this.showError(`No se pudo guardar tu respuesta para "${card.word}".`);
        return undefined;
      }
    });
  }

  private undoSavedAnswer(saved?: Promise<AnswerRecord | undefined>) {
    if (!saved) return;

    const topic = this.topic;
    this.enqueueSave(async () => {
      const record = await saved;
      if (!record) return;
      try {
        await this.flashcardService.undoAnswer(topic, record);
      } catch (error) {
        console.error('No se pudo deshacer la respuesta', error);
        this.showError(`No se pudo deshacer tu respuesta para "${record.previous.word}".`);
      }
    });
  }

  private enqueueSave<T>(task: () => Promise<T>): Promise<T> {
    const result = this.saveQueue.then(task);
    this.saveQueue = result.catch(() => undefined);
    return result;
  }

  private showError(message: string) {
    return this.showToast(message, 'danger');
  }

  private showToast(message: string, color: 'danger' | 'dark') {
    return this.toast.show(message, { color });
  }

  flip() {
    this.isFlipped = !this.isFlipped;
    this.clearAutoSpeakTimer();

    if (this.isFlipped && this.currentCard) {
      this.speakSoon(this.currentCard.word);
    }
  }

  exitStudy() {
    this.clearQuizTimer();
    this.clearAutoSpeakTimer();
    this.speech.stop();
    this.navController.navigateBack(this.returnUrl);
  }

  // Al salir de cualquier forma (también con el botón atrás de Android), cuando terminen de guardarse las respuestas.
  ionViewWillLeave() {
    this.saveQueue.then(() => this.flashcardService.cardsChanged.next());
  }

  next() {
    this.clearAutoSpeakTimer();

    if (this.currentIndex < this.cards.length - 1) {
      this.moveTo(this.currentIndex + 1);
    } else {
      this.finishSession();
    }
  }

  private moveTo(index: number) {
    const previousImageUrl = this.currentCard?.imageUrl;
    this.currentIndex = index;
    this.showFront();
    this.prepareExercise();
    // Con la misma imagen (p. ej. una difícil que se repite enseguida) el navegador no vuelve a emitir load.
    if (this.currentCard?.imageUrl !== previousImageUrl) {
      this.imageLoaded = false;
      this.imageFailed = false;
    }
  }

  // La presentación de una palabra nueva no pregunta nada. Las demás apariciones sortean un ejercicio de su etapa
  // (ver stageOf) sin repetir el anterior, si hay otro. Si no se puede ninguno (sin imagen, o sin otras palabras del
  // tema que sirvan de opción), se muestra como tarjeta normal.
  private prepareExercise() {
    this.clearQuizTimer();
    // La voz pendiente era del ejercicio anterior: en "elige la palabra" daría la respuesta.
    this.clearAutoSpeakTimer();
    this.exercise = 'card';
    this.exerciseRound++;
    this.quizChoice = null;
    this.quizOptions = [];
    this.exerciseResult = null;
    this.autoAdvanceMs = 0;
    this.mnemonic = null;
    this.creatingMnemonic = false;

    const card = this.currentCard;
    if (!card) return;

    // No cuenta para no repetir ejercicio: el siguiente se sortea contra el último de verdad.
    if (this.introIndexes.has(this.currentIndex)) {
      this.exercise = 'intro';
      this.speakSoon(card.word);
      return;
    }

    const stage = stageOf(card);
    const kinds = this.exercisesFor(card, stage);
    const ordered = [
      ...shuffle(kinds.filter(kind => kind !== this.lastExercise)),
      ...kinds.filter(kind => kind === this.lastExercise)
    ];
    for (const kind of ordered) {
      if (kind === 'pick-image' || kind === 'pick-word' || kind === 'listen') {
        const distractors = this.pickDistractors(card, kind);
        if (!distractors.length) continue;
        this.quizOptions = shuffle([card, ...distractors]);
      }
      this.exercise = kind;
      break;
    }
    // Al producirla hay que decirla de memoria.
    this.speakHints = stage !== 'produce';
    this.lastExercise = this.exercise;

    if (this.exercise === 'listen') {
      this.speakSoon(card.word);
    }
  }

  // Los ejercicios de cada etapa. Todos menos la tarjeta necesitan la imagen: sin ella, la tarjeta muestra la palabra.
  private exercisesFor(card: Flashcard, stage: Stage): DrawnExercise[] {
    if (!card.imageUrl) return ['card'];

    const canListen = 'speechSynthesis' in window && !this.listeningDeclined;
    // Solo donde hay reconocimiento de voz (hoy, Chrome y Safari; no Firefox ni la app nativa).
    const canSpeak = this.speech.isSupported && !this.speechBlocked;
    if (stage === 'recognize') return canListen ? ['pick-image', 'listen'] : ['pick-image'];
    if (stage === 'recall') return canSpeak ? ['pick-word', 'speak', 'card'] : ['pick-word', 'card'];
    return canSpeak ? ['write', 'speak'] : ['write'];
  }

  // Hasta 3 opciones falsas que no sean también correctas. Primero las que se confunden con ella (las propuso la IA al
  // crearla: knife / fork, shelf / shell), para que haya que distinguirla de verdad; luego otras del tema al azar,
  // aprendidas o no.
  private pickDistractors(card: Flashcard, kind: QuizKind): Flashcard[] {
    const target = card.word.toLowerCase();
    const seenWords = new Set([target]);
    const seenTranslations = new Set([card.translation.toLowerCase()]);
    const seenImages = new Set([card.imageUrl]);
    const distractors: Flashcard[] = [];

    // Las que no son del tema no tienen imagen ni traducción: solo sirven para elegir la palabra.
    const topicCardsByWord = new Map(this.topicCards.map(other => [other.word.toLowerCase(), other]));
    const confusables = (card.confusables ?? [])
      .map(word => topicCardsByWord.get(word.toLowerCase()) ?? { word, translation: '', imageUrl: '' });

    for (const other of [...confusables, ...shuffle(this.topicCards)]) {
      const word = other.word.toLowerCase();
      const translation = other.translation.toLowerCase();
      if (seenWords.has(word)) continue;
      // Mismo significado ("big" y "large") u otra forma de la palabra ("knives"): serían dos respuestas correctas.
      if ((translation && seenTranslations.has(translation)) || isSameWord(word, target)) continue;
      // Eligiendo imagen, cada opción necesita una imagen propia.
      if (kind !== 'pick-word' && (!other.imageUrl || seenImages.has(other.imageUrl))) continue;

      seenWords.add(word);
      if (translation) seenTranslations.add(translation);
      seenImages.add(other.imageUrl);
      distractors.push(other);
      if (distractors.length === 3) break;
    }

    return distractors;
  }

  private clearQuizTimer() {
    if (this.quizTimer) {
      clearTimeout(this.quizTimer);
      this.quizTimer = undefined;
    }
  }

  // Para una tarjeta nueva: frente sin animar y traducción oculta.
  private showFront() {
    this.showTranslation = false;
    if (!this.isFlipped) return;

    this.isFlipped = false;
    this.instantFlip = true;
    // Dos fotogramas: el primero pinta el frente sin transición; después se recupera la animación.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      this.instantFlip = false;
    }));
  }

  private finishSession() {
    const results = [...this.sessionResults.values()];
    const hard = results.filter(result => result === 'hard').length;

    const summary: SessionSummary = { knew: results.length - hard, hard };
    this.summary = summary;
    this.completeSummary(summary, [...this.steps]);
  }

  // Las palabras y la racha, cuando se guarden las respuestas. Si mientras tanto se deshizo la última o se empezó la
  // ronda de difíciles, ese resumen ya no está en pantalla.
  private async completeSummary(summary: SessionSummary, steps: SessionStep[]) {
    const words = await this.summaryWords(steps);
    let streak: Streak | undefined;
    try {
      // Ya con las respuestas guardadas, que cuentan en la actividad del día.
      streak = await this.statsService.getStreak();
    } catch (error) {
      console.warn('No se pudo leer la racha', error);
    }
    if (this.summary !== summary) return;

    const before = this.streakAtStart;
    this.summary = {
      ...summary,
      words,
      streak: streak && {
        ...streak,
        grew: !!before && streak.current > before.current,
        record: !!before && streak.current > before.best
      }
    };
  }

  // Por palabra: cómo estaba en su primera respuesta guardada y cómo quedó tras la última. Las que no se pudieron
  // guardar no salen.
  private async summaryWords(steps: SessionStep[]): Promise<SummaryWord[]> {
    const records = await Promise.all(steps.map(step => step.saved));
    const words = new Map<string, SummaryWord>();
    records.forEach((record, index) => {
      if (!record) return;
      const { card, knew } = steps[index];
      const first = words.get(card.word);
      // La imagen, de la sesión: pudo cambiarse después de responder.
      const imageUrl = this.cards.find(other => other.word === card.word)?.imageUrl ?? record.current.imageUrl;
      words.set(card.word, {
        card: { ...record.current, imageUrl },
        before: first?.before ?? record.previous,
        hard: (first?.hard ?? false) || !knew
      });
    });
    return [...words.values()];
  }

  reviewHardCards() {
    const hardCards = new Map(
      this.cards
        .filter(card => this.sessionResults.get(card.word) === 'hard')
        .map(card => [card.word, card])
    );

    this.cards = shuffle([...hardCards.values()]);
    // Ya se presentaron en la sesión.
    this.introIndexes = new Set();
    this.currentIndex = 0;
    this.showFront();
    this.prepareExercise();
    this.imageLoaded = false;
    this.imageFailed = false;
    this.sessionResults.clear();
    // La ronda de difíciles empieza de cero: no se puede volver a la sesión anterior.
    this.steps = [];
    this.summary = null;
  }

  // interrupt: el botón de pronunciación corta lo que esté sonando; la voz automática se encola tras la locución muda.
  speak(word: string, interrupt = true) {
    // Si se pulsa el botón antes de la voz automática, que no suene dos veces.
    if (interrupt) {
      this.clearAutoSpeakTimer();
    }
    this.pronunciation.speak(word, interrupt);
  }

  // La locución muda despierta el audio del móvil mientras entra la tarjeta; la voz real va detrás.
  private speakSoon(word: string) {
    this.clearAutoSpeakTimer();
    this.pronunciation.warmUp(word);
    this.autoSpeakTimer = setTimeout(() => {
      this.autoSpeakTimer = undefined;
      this.speak(word, false);
    }, 600);
  }

  private clearAutoSpeakTimer() {
    if (this.autoSpeakTimer) {
      clearTimeout(this.autoSpeakTimer);
      this.autoSpeakTimer = undefined;
    }
  }

  onImageLoaded() {
    this.imageLoaded = true;
  }

  onImageError() {
    this.imageFailed = true;
  }

}
