import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonProgressBar, IonSpinner, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { volumeHighOutline, arrowForwardOutline, arrowBackOutline, closeOutline, sparklesOutline, imageOutline } from 'ionicons/icons';
import { Flashcard, FlashcardService } from 'src/app/services/flashcard';
import { AllLearnedComponent } from './all-learned/all-learned.component';
import { SessionSummary, SessionSummaryComponent } from './session-summary/session-summary.component';

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
    AllLearnedComponent,
    SessionSummaryComponent
  ],
  templateUrl: './flashcards.page.html',
  styleUrls: ['./flashcards.page.scss'],
})
export class FlashcardsPage {
  cards: Flashcard[] = [];
  currentIndex = 0;
  isFlipped = false;
  loading = true;
  loadingError = false;
  allLearned = false;
  imageLoaded = false;
  imageFailed = false;
  summary: SessionSummary | null = null;
  // Resultado de cada palabra en la sesión; 'hard' si se marcó difícil al menos una vez.
  private sessionResults = new Map<string, 'knew' | 'hard'>();
  topic = '';
  dragX = 0;
  dragY = 0;
  isDragging = false;
  private answering = false;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private readonly SWIPE_THRESHOLD = 100;
  private flipSpeakTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private router: Router,
    private flashcardService: FlashcardService,
    private toastController: ToastController
  ) {
    addIcons({ volumeHighOutline, arrowForwardOutline, arrowBackOutline, closeOutline, sparklesOutline, imageOutline });
  }

  // Única carga de la sesión: Ionic llama a este hook cada vez que se entra en la página, también la primera.
  async ionViewWillEnter() {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state; // fallback si se recarga la página

    const topic = state?.['topic'] as string | undefined;
    const count = state?.['count'] as number | undefined;

    if (!topic || !count) {
      await this.router.navigate(['/study-setup']);
      return;
    }

    this.topic = topic;
    this.loading = true;
    this.loadingError = false;
    this.allLearned = false;
    this.currentIndex = 0;
    this.isFlipped = false;
    this.imageLoaded = false;
    this.imageFailed = false;
    this.summary = null;
    this.sessionResults.clear();

    try {
      const storedCards = await this.flashcardService.getStoredFlashcards(topic, count);
      const pendingCards = storedCards
        ?? ((state?.['cards'] ?? []) as Flashcard[]).filter(card => !card.learned).slice(0, count);
      this.allLearned = storedCards?.length === 0;
      this.loadingError = !pendingCards.length;
      this.cards = pendingCards.sort(() => Math.random() - 0.5);
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

  // Respuesta por deslizamiento o con las flechas: la tarjeta sale animada y se pasa a la siguiente.
  private answer(knew: boolean) {
    const card = this.currentCard;
    // Evita responder dos veces la misma tarjeta (p. ej. al mantener pulsada una flecha).
    if (!card || this.answering) return;

    this.answering = true;
    this.dragX = knew ? 500 : -500;
    this.saveAnswer(card, knew);
    if (knew) {
      if (!this.sessionResults.has(card.word)) {
        this.sessionResults.set(card.word, 'knew');
      }
    } else {
      this.sessionResults.set(card.word, 'hard');
      // Las difíciles se repiten al final de la sesión.
      this.cards.push(card);
    }

    setTimeout(() => {
      this.dragX = 0;
      this.dragY = 0;
      this.answering = false;
      this.next();
    }, 250);
  }

  // No se espera desde el swipe para no frenar la animación; los errores se avisan aquí.
  private async saveAnswer(card: Flashcard, knew: boolean) {
    try {
      await this.flashcardService.recordAnswer(this.topic, card.word, knew);
    } catch (error) {
      console.error('No se pudo guardar la respuesta', error);
      const toast = await this.toastController.create({
        message: `No se pudo guardar tu respuesta para "${card.word}".`,
        duration: 3000,
        position: 'top',
        color: 'danger'
      });
      await toast.present();
    }
  }

  flip() {
    this.isFlipped = !this.isFlipped;
    this.clearFlipSpeakTimer();

    if (this.isFlipped) {
      // En el móvil el audio se "duerme" tras un rato en silencio y se come el comienzo de la palabra.
      // Una locución muda en el mismo toque lo despierta durante la animación; la voz real se encola detrás.
      this.warmUpSpeech(this.currentCard?.word ?? '');
      this.flipSpeakTimer = setTimeout(() => {
        this.speakCurrentCard();
        this.flipSpeakTimer = undefined;
      }, 600);
    }
  }

  exitStudy() {
    this.router.navigate(['/study-setup']);
  }

  next() {
    this.clearFlipSpeakTimer();

    if (this.currentIndex < this.cards.length - 1) {
      const previousImageUrl = this.currentCard?.imageUrl;
      this.currentIndex++;
      this.isFlipped = false;
      // Con la misma imagen (p. ej. una difícil que se repite enseguida) el navegador no vuelve a emitir load.
      if (this.currentCard?.imageUrl !== previousImageUrl) {
        this.imageLoaded = false;
        this.imageFailed = false;
      }
    } else {
      this.finishSession();
    }
  }

  private finishSession() {
    const results = [...this.sessionResults.values()];
    const hard = results.filter(result => result === 'hard').length;
    const sessionWords = new Set(this.cards.map(card => card.word));

    this.summary = {
      knew: results.length - hard,
      hard,
      skipped: sessionWords.size - results.length
    };
  }

  reviewHardCards() {
    const hardCards = new Map(
      this.cards
        .filter(card => this.sessionResults.get(card.word) === 'hard')
        .map(card => [card.word, card])
    );

    this.cards = [...hardCards.values()].sort(() => Math.random() - 0.5);
    this.currentIndex = 0;
    this.isFlipped = false;
    this.imageLoaded = false;
    this.imageFailed = false;
    this.sessionResults.clear();
    this.summary = null;
  }

  // interrupt: el botón de pronunciación corta lo que esté sonando; la voz automática se encola tras la locución muda.
  speak(word: string, interrupt = true) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    if (interrupt) {
      // Si se pulsa el botón antes de la voz automática, que no suene dos veces.
      this.clearFlipSpeakTimer();
      // cancel() justo antes de speak() puede recortar el comienzo: solo si de verdad hay algo sonando.
      if (synthesizer.speaking || synthesizer.pending) {
        synthesizer.cancel();
      }
    }
    synthesizer.resume();
    synthesizer.speak(this.createUtterance(synthesizer, word));
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

  private clearFlipSpeakTimer() {
    if (this.flipSpeakTimer) {
      clearTimeout(this.flipSpeakTimer);
      this.flipSpeakTimer = undefined;
    }
  }

  onImageLoaded() {
    this.imageLoaded = true;
  }

  onImageError() {
    this.imageFailed = true;
  }

  private speakCurrentCard() {
    const card = this.currentCard;
    if (card) {
      this.speak(card.word, false);
    }
  }

}
