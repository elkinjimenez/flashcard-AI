import { Component, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonProgressBar, IonSpinner, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  volumeHighOutline, closeOutline, imageOutline, imagesOutline, eyeOutline, eyeOffOutline, bulbOutline
} from 'ionicons/icons';
import { AnswerRecord, Flashcard, FlashcardService } from 'src/app/services/flashcard';
import { mnemonicMisses } from 'src/app/services/flashcard.model';
import { SessionSummary, SessionSummaryComponent } from './session-summary/session-summary.component';
import { SessionStep, StudySession, shuffle } from './study-session';
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
import { AnswerFeedbackService } from 'src/app/services/answer-feedback';
import { StatsService, Streak } from 'src/app/services/stats';
import { CardModalService } from 'src/app/services/card-modal';
import { CardImageDirective } from 'src/app/card-image.directive';

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

// Cabecera del repaso de todos los temas. Sin el tema de la palabra en pantalla: saberlo sería una pista.
const mixedReviewTitle = 'Todos los temas';

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
    ActionBarComponent,
    CardImageDirective
  ],
  templateUrl: './flashcards.page.html',
  styleUrls: ['./flashcards.page.scss'],
})
export class FlashcardsPage {
  private router = inject(Router);
  private flashcardService = inject(FlashcardService);
  private toast = inject(ToastService);
  private speech = inject(SpeechRecognitionService);
  private cardModal = inject(CardModalService);
  private navController = inject(NavController);
  private pronunciation = inject(PronunciationService);
  private statsService = inject(StatsService);
  private feedback = inject(AnswerFeedbackService);

  // Orden de las tarjetas, repeticiones y deshacer (ver StudySession).
  private session = new StudySession();
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
  // Todas las palabras de cada tema de la sesión (también las aprendidas), de donde salen las opciones incorrectas.
  private topicCards = new Map<string, Flashcard[]>();
  private lastExercise: ExerciseKind | null = null;
  // Sin micrófono o sin permiso, el ejercicio de habla deja de salir en la sesión.
  private speechBlocked = false;
  // Si ahora no puede escuchar, tampoco sale el de escuchar.
  private listeningDeclined = false;
  private quizTimer?: ReturnType<typeof setTimeout>;
  // Las escrituras van en fila: deshacer debe restaurar después de que se guardó la respuesta y antes de la siguiente.
  private saveQueue: Promise<unknown> = Promise.resolve();
  // Racha al empezar: el resumen dice si la sesión le sumó un día o batió el récord. undefined si no se pudo leer.
  private streakAtStart?: Streak;
  // El tema de la sesión; con palabras de varios temas, su título.
  topic = '';
  // Con palabras de varios temas, el de cada una (ver topicOf); vacío en la sesión de un tema.
  private cardTopics = new Map<string, string>();
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
    addIcons({ volumeHighOutline, closeOutline, imageOutline, imagesOutline, eyeOutline, eyeOffOutline, bulbOutline });
    this.flashcardService.imageDropped.pipe(takeUntilDestroyed()).subscribe(imageUrl => this.onImageDropped(imageUrl));
  }

  // Única carga de la sesión: Ionic llama a este hook cada vez que se entra en la página, también la primera.
  async ionViewWillEnter() {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state; // fallback si se recarga la página

    // Palabras de varios temas (ver MixedReview): sin tema, pero con el de cada palabra, y su título si lo trae.
    const cardTopics = new Map(Object.entries((state?.['cardTopics'] ?? {}) as Record<string, string>));
    const topic = cardTopics.size ? state?.['title'] as string | undefined ?? mixedReviewTitle
      : state?.['topic'] as string | undefined;
    // Las elige la pestaña de la que se viene (repasos o palabras recién añadidas), adonde se vuelve al salir.
    const sessionCards = (state?.['cards'] ?? []) as Flashcard[];
    this.returnUrl = state?.['returnUrl'] ?? '/tabs/topics';

    if (!topic || !sessionCards.length) {
      await this.router.navigate([this.returnUrl]);
      return;
    }

    this.topic = topic;
    this.cardTopics = cardTopics;
    this.loading = true;
    this.loadingError = false;
    this.isFlipped = false;
    this.showTranslation = false;
    this.imageLoaded = false;
    this.imageFailed = false;
    this.summary = null;
    this.cardMotion = null;
    this.streakAtStart = undefined;
    this.statsService.getStreak()
      .then(streak => this.streakAtStart = streak)
      .catch(error => console.warn('No se pudo leer la racha', error));

    try {
      this.session = StudySession.plan(sessionCards);
      this.topicCards = new Map(await Promise.all(this.sessionTopics.map(async sessionTopic =>
        [sessionTopic, await this.flashcardService.getTopicCards(sessionTopic)] as const)));
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
    return this.session.current;
  }

  // Para la mini-historia; en el repaso de todos los temas, los de sus palabras.
  get storyTopic(): string {
    return this.sessionTopics.join(', ');
  }

  private get sessionTopics(): string[] {
    return this.cardTopics.size ? [...new Set(this.cardTopics.values())] : [this.topic];
  }

  // Palabras distintas de la sesión (o de la ronda de difíciles).
  get sessionWords(): number {
    return this.session.words;
  }

  get completedWords(): number {
    return this.summary ? this.sessionWords : this.session.completedWords(this.exerciseAnswered);
  }

  get progress(): number {
    const total = this.sessionWords;
    return total ? this.completedWords / total : 0;
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
    return this.session.canUndo;
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
    this.recordAnswer(card, knew);
    this.feedback.answered(knew);

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
  private async showMnemonic(topic: string, saved?: Promise<AnswerRecord | undefined>) {
    const round = this.exerciseRound;
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
    const step = this.recordAnswer(card, knew);
    this.feedback.answered(knew);
    this.speak(card.word);
    if (!knew) {
      this.showMnemonic(this.topicOf(card.word), step.saved);
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

    const imageUrl = await this.cardModal.open<string>(ImagePickerComponent, { card });
    if (!imageUrl || imageUrl === card.imageUrl) return;

    this.replaceImage(card.word, imageUrl);
    const topic = this.topicOf(card.word);
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

  // Una imagen de la sesión ya no existe (ver dropMissingImage): las tarjetas que la usaban siguen sin ella. Si sale en el
  // ejercicio en pantalla y aún no se respondió, este se vuelve a sortear: sin ella no se podría responder bien. Ya
  // respondido, se queda como está hasta pasar a la siguiente.
  private onImageDropped(imageUrl: string) {
    const inExercise = [this.currentCard, ...this.quizOptions].some(card => card?.imageUrl === imageUrl);
    const answered = this.exerciseAnswered;
    const drop = (card: Flashcard) => card.imageUrl === imageUrl ? { ...card, imageUrl: '' } : card;
    this.session.updateCards((card, isCurrent) => answered && isCurrent ? card : drop(card));
    this.updateTopicCards(drop);

    // La tarjeta y la presentación ya se muestran bien sin imagen.
    if (inExercise && !answered && this.exercise !== 'card' && this.exercise !== 'intro') {
      this.prepareExercise();
      this.cardMotion = 'enter';
    }
  }

  // En todas las copias de la tarjeta en la sesión (las difíciles se repiten) y en las opciones de los ejercicios.
  private replaceImage(word: string, imageUrl: string) {
    const update = (card: Flashcard) => card.word === word ? { ...card, imageUrl } : card;
    this.session.updateCards(update);
    this.updateTopicCards(update, this.topicOf(word));
    this.quizOptions = this.quizOptions.map(update);
    this.imageLoaded = false;
    this.imageFailed = false;
  }

  // En las palabras de un tema de la sesión; sin tema, en las de todos.
  private updateTopicCards(update: (card: Flashcard) => Flashcard, topic?: string) {
    this.topicCards = new Map([...this.topicCards].map(([name, cards]) =>
      [name, topic === undefined || name === topic ? cards.map(update) : cards]));
  }

  // En el repaso de todos los temas, cada palabra se guarda en el suyo.
  private topicOf(word: string): string {
    return this.cardTopics.get(word) ?? this.topic;
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

    this.session.markKnown(this.saveAnswer(card, topic => this.flashcardService.markKnown(topic, card.word)));
    this.showToast(`«${card.word}» pasa a tus repasos: volverá en unas semanas para comprobarlo.`, 'dark');
    this.advance();
  }

  // Guarda la respuesta de un ejercicio y la apunta en la sesión, que la repite si falló.
  private recordAnswer(card: Flashcard, knew: boolean): SessionStep {
    const saved = this.saveAnswer(card, topic => this.flashcardService.recordAnswer(topic, card.word, knew));
    return this.session.answer(knew, saved);
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
    if (!this.session.canUndo || this.answering) return;
    this.clearQuizTimer();

    // Desde el resumen no hay tarjeta que retirar.
    if (this.summary) {
      this.revertLastStep();
      return;
    }

    this.answering = true;
    this.cardMotion = 'leave-back';
    setTimeout(() => {
      this.answering = false;
      this.revertLastStep();
    }, 250);
  }

  // Solo la animación de la propia tarjeta: las de los sellos de Difícil / La sé también llegan aquí.
  onCardAnimationEnd(event: AnimationEvent) {
    if (event.target === event.currentTarget && (this.cardMotion === 'enter' || this.cardMotion === 'enter-back')) {
      this.cardMotion = null;
    }
  }

  private revertLastStep() {
    const previousImageUrl = this.currentCard?.imageUrl;
    const step = this.session.undo();
    if (!step) return;

    this.summary = null;
    this.clearAutoSpeakTimer();
    this.showCard(previousImageUrl);
    this.cardMotion = 'enter-back';
    this.undoSavedAnswer(this.topicOf(step.card.word), step.saved);
  }

  // No se espera desde el swipe para no frenar la animación; los errores se avisan aquí.
  private saveAnswer(
    card: Flashcard,
    save: (topic: string) => Promise<AnswerRecord | undefined>
  ): Promise<AnswerRecord | undefined> {
    const topic = this.topicOf(card.word);
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

  private undoSavedAnswer(topic: string, saved?: Promise<AnswerRecord | undefined>) {
    if (!saved) return;

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

  // Salir a mitad de sesión no cuesta nada: se avisa de que lo respondido quedó guardado. Tras la transición, para no
  // avisar si se cancela el gesto de volver.
  ionViewDidLeave() {
    const answered = this.summary ? 0 : this.session.answeredWords;
    if (!answered) return;

    const words = answered === 1 ? '1 palabra' : `${answered} palabras`;
    const pending = this.completedWords < this.sessionWords ? ' Las demás te esperan en la próxima práctica.' : '';
    this.saveQueue.then(() =>
      this.toast.show(`Tu progreso en ${words} quedó guardado.${pending}`, { color: 'dark', duration: 4000 }));
  }

  next() {
    this.clearAutoSpeakTimer();

    const previousImageUrl = this.currentCard?.imageUrl;
    if (this.session.next()) {
      this.showCard(previousImageUrl);
    } else {
      this.finishSession();
    }
  }

  // Tras pasar a otra tarjeta de la sesión: su frente y su ejercicio.
  private showCard(previousImageUrl: string | undefined) {
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
    if (this.session.isIntro) {
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

    // Las del tema de la palabra, también en el repaso de todos los temas: se parecen más a ella. Las que no son del tema
    // no tienen imagen ni traducción: solo sirven para elegir la palabra.
    const topicCards = this.topicCards.get(this.topicOf(card.word)) ?? [];
    const topicCardsByWord = new Map(topicCards.map(other => [other.word.toLowerCase(), other]));
    const confusables = (card.confusables ?? [])
      .map(word => topicCardsByWord.get(word.toLowerCase()) ?? { word, translation: '', imageUrl: '' });

    for (const other of [...confusables, ...shuffle(topicCards)]) {
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
    const summary: SessionSummary = this.session.tally;
    this.summary = summary;
    this.completeSummary(summary);
  }

  // Las palabras y la racha, cuando se guarden las respuestas. Si mientras tanto se deshizo la última o se empezó la
  // ronda de difíciles, ese resumen ya no está en pantalla.
  private async completeSummary(summary: SessionSummary) {
    const words = await this.session.summaryWords();
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

  reviewHardCards() {
    this.session = this.session.hardRound();
    this.showFront();
    this.prepareExercise();
    this.imageLoaded = false;
    this.imageFailed = false;
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
