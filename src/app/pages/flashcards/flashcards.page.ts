import { Component, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonProgressBar, IonSpinner, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  volumeHighOutline, arrowBackOutline, imageOutline, imagesOutline, eyeOutline, eyeOffOutline
} from 'ionicons/icons';
import { AnswerRecord, Flashcard, FlashcardService } from 'src/app/services/flashcard';
import { SessionSummary, SessionSummaryComponent } from './session-summary/session-summary.component';
import { QuizCardComponent, QuizKind } from './quiz-card/quiz-card.component';
import { SpeakCardComponent, SpeechUnavailableReason } from './speak-card/speak-card.component';
import { ImagePickerComponent } from './image-picker/image-picker.component';
import { ActionBarComponent, ActionMode } from './action-bar/action-bar.component';
import { SpeechRecognitionService } from 'src/app/services/speech-recognition';
import { wordPattern } from 'src/app/services/word-forms';
import { ToastService } from 'src/app/services/toast';

// speak: ver la imagen y decir la palabra en voz alta.
type ExerciseKind = 'card' | QuizKind | 'speak';

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Lo que se hizo con una tarjeta, con lo necesario para deshacerlo.
interface SessionStep {
  index: number;
  card: Flashcard;
  knew: boolean;
  previousResult?: 'knew' | 'hard';
  // La respuesta guardada; undefined si no se pudo guardar.
  saved?: Promise<AnswerRecord | undefined>;
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
  // Sube en cada aparición de una tarjeta: el ejercicio de habla se reinicia con él.
  exerciseRound = 0;
  // La correcta y hasta 3 palabras más del tema, en orden aleatorio.
  quizOptions: Flashcard[] = [];
  quizChoice: Flashcard | null = null;
  // Resultado del ejercicio actual (opción múltiple o habla); null mientras no se responde.
  exerciseResult: boolean | null = null;
  // Tras acertar se avanza solo pasado este tiempo, y el botón Continuar se va llenando; 0: espera al botón.
  autoAdvanceMs = 0;
  // Todas las palabras del tema (también las aprendidas), de donde salen las opciones incorrectas.
  private topicCards: Flashcard[] = [];
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
  topic = '';
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

  constructor() {
    addIcons({ volumeHighOutline, arrowBackOutline, imageOutline, imagesOutline, eyeOutline, eyeOffOutline });
  }

  // Única carga de la sesión: Ionic llama a este hook cada vez que se entra en la página, también la primera.
  async ionViewWillEnter() {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state; // fallback si se recarga la página

    const topic = state?.['topic'] as string | undefined;
    // Las elige la pantalla de inicio (repasos del tema o palabras recién añadidas).
    const sessionCards = (state?.['cards'] ?? []) as Flashcard[];

    if (!topic || !sessionCards.length) {
      await this.router.navigate(['/study-setup']);
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

    try {
      this.cards = shuffle(sessionCards);
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
    if (this.exerciseAnswered) return 'continue';
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

  // No lo sé: cuenta como fallo y muestra la respuesta. En el de habla la muestra el propio ejercicio, que avisa con answered.
  giveUp() {
    if (this.exercise === 'speak') {
      this.speakCard?.giveUp();
    } else {
      this.finishExercise(false);
    }
  }

  // Acertar cuenta como La sé y fallar como Difícil. Si acierta pasa sola; si falla espera a Continuar, para que vea cuál era.
  private finishExercise(knew: boolean) {
    const card = this.currentCard;
    if (!card || this.exerciseAnswered || this.answering) return;

    this.exerciseResult = knew;
    this.registerAnswer(card, knew);
    this.speak(card.word);

    // Eligiendo imagen espera más: tras responder, cada imagen muestra su palabra y da tiempo a leerlas.
    const pickedImage = this.exercise === 'pick-image' || this.exercise === 'listen';
    this.autoAdvanceMs = !knew ? 0 : pickedImage ? 3000 : this.exercise === 'speak' ? 1500 : 1000;
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

  // Guarda la respuesta y la apunta en la sesión y en el historial para poder deshacerla.
  private registerAnswer(card: Flashcard, knew: boolean) {
    this.steps.push({
      index: this.currentIndex,
      card,
      knew,
      previousResult: this.sessionResults.get(card.word),
      saved: this.saveAnswer(card, knew)
    });
    if (knew) {
      if (!this.sessionResults.has(card.word)) {
        this.sessionResults.set(card.word, 'knew');
      }
    } else {
      this.sessionResults.set(card.word, 'hard');
      // Las difíciles se repiten al final de la sesión.
      this.cards.push(card);
    }
  }

  // Continuar tras un ejercicio respondido: la respuesta ya está en el historial, solo se pasa a la siguiente.
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
    // La difícil se había añadido al final de la sesión. Se quita después de moverse: moveTo compara con la tarjeta actual.
    if (!step.knew) {
      this.cards.pop();
    }
    this.undoSavedAnswer(step.saved);
  }

  // No se espera desde el swipe para no frenar la animación; los errores se avisan aquí.
  private saveAnswer(card: Flashcard, knew: boolean): Promise<AnswerRecord | undefined> {
    const topic = this.topic;
    return this.enqueueSave(async () => {
      try {
        return await this.flashcardService.recordAnswer(topic, card.word, knew);
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
    this.router.navigate(['/study-setup']);
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

  // Cada aparición de una tarjeta sortea su ejercicio (tarjeta, elige la imagen, elige la palabra, escucha o dilo en voz alta)
  // sin repetir el anterior. Sin imagen, o sin otras palabras del tema que sirvan de opción, se muestra como tarjeta normal.
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

    const card = this.currentCard;
    if (!card) return;

    const kinds: ExerciseKind[] = card.imageUrl ? ['card', 'pick-image', 'pick-word'] : ['card'];
    if (card.imageUrl && 'speechSynthesis' in window && !this.listeningDeclined) {
      kinds.push('listen');
    }
    // Solo donde hay reconocimiento de voz (hoy, Chrome y Safari; no Firefox ni la app nativa).
    if (card.imageUrl && this.speech.isSupported && !this.speechBlocked) {
      kinds.push('speak');
    }
    const candidates = kinds.length > 1 ? kinds.filter(kind => kind !== this.lastExercise) : kinds;
    const kind = candidates[Math.floor(Math.random() * candidates.length)];

    if (kind === 'speak') {
      this.exercise = 'speak';
    } else if (kind !== 'card') {
      const distractors = this.pickDistractors(card, kind);
      if (distractors.length) {
        this.exercise = kind;
        this.quizOptions = shuffle([card, ...distractors]);
      }
    }
    this.lastExercise = this.exercise;

    if (this.exercise === 'listen') {
      this.speakSoon(card.word);
    }
  }

  // Hasta 3 palabras del tema, aprendidas o no, que no se confundan con la correcta.
  private pickDistractors(card: Flashcard, kind: QuizKind): Flashcard[] {
    const seenWords = new Set([card.word.toLowerCase()]);
    const seenTranslations = new Set([card.translation.toLowerCase()]);
    const seenImages = new Set([card.imageUrl]);
    const distractors: Flashcard[] = [];

    for (const other of shuffle(this.topicCards)) {
      const word = other.word.toLowerCase();
      const translation = other.translation.toLowerCase();
      // Mismo significado (p. ej. "big" y "large"): serían dos respuestas correctas.
      if (seenWords.has(word) || seenTranslations.has(translation)) continue;
      // Eligiendo imagen, cada opción necesita una imagen propia.
      if (kind !== 'pick-word' && (!other.imageUrl || seenImages.has(other.imageUrl))) continue;

      seenWords.add(word);
      seenTranslations.add(translation);
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

    this.summary = {
      knew: results.length - hard,
      hard
    };
  }

  reviewHardCards() {
    const hardCards = new Map(
      this.cards
        .filter(card => this.sessionResults.get(card.word) === 'hard')
        .map(card => [card.word, card])
    );

    this.cards = shuffle([...hardCards.values()]);
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
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    if (interrupt) {
      // Si se pulsa el botón antes de la voz automática, que no suene dos veces.
      this.clearAutoSpeakTimer();
      // cancel() justo antes de speak() puede recortar el comienzo: solo si de verdad hay algo sonando.
      if (synthesizer.speaking || synthesizer.pending) {
        synthesizer.cancel();
      }
    }
    synthesizer.resume();
    synthesizer.speak(this.createUtterance(synthesizer, word));
  }

  // En el móvil el audio se "duerme" tras un rato en silencio y se come el comienzo de la palabra.
  // Una locución muda lo despierta mientras entra la tarjeta; la voz real se encola detrás.
  private speakSoon(word: string) {
    this.clearAutoSpeakTimer();
    this.warmUpSpeech(word);
    this.autoSpeakTimer = setTimeout(() => {
      this.autoSpeakTimer = undefined;
      this.speak(word, false);
    }, 600);
  }

  private warmUpSpeech(word: string) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    if (synthesizer.speaking || synthesizer.pending) {
      synthesizer.cancel();
    }
    const utterance = this.createUtterance(synthesizer, word);
    utterance.volume = 0;
    // Más rápida para que termine antes de que empiece la voz real.
    utterance.rate = 2;
    synthesizer.speak(utterance);
  }

  private createUtterance(synthesizer: SpeechSynthesis, word: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(word.trim());
    utterance.rate = 0.85;
    utterance.lang = 'en-US';
    const englishVoice = synthesizer.getVoices()
      .find(voice => voice.lang.toLowerCase().startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    return utterance;
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
