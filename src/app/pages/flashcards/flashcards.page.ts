import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonProgressBar, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { volumeHighOutline, arrowForwardOutline, arrowBackOutline, closeOutline, sparklesOutline } from 'ionicons/icons';
import { Flashcard, FlashcardService } from 'src/app/services/flashcard';
import { AllLearnedComponent } from './all-learned/all-learned.component';

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
    AllLearnedComponent
  ],
  templateUrl: './flashcards.page.html',
  styleUrls: ['./flashcards.page.scss'],
})
export class FlashcardsPage implements OnInit {
  cards: Flashcard[] = [];
  currentIndex = 0;
  isFlipped = false;
  loading = true;
  loadingError = false;
  allLearned = false;
  imageLoaded = false;
  topic = '';
  private studyCount = 0;
  dragX = 0;
  dragY = 0;
  isDragging = false;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private readonly SWIPE_THRESHOLD = 100;
  private flipSpeakTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private router: Router,
    private flashcardService: FlashcardService
  ) {
    addIcons({ volumeHighOutline, arrowForwardOutline, arrowBackOutline, closeOutline, sparklesOutline });
  }

  async ngOnInit() {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state; // fallback si se recarga la página

    const topic = state?.['topic'];
    const count = state?.['count'];

    if (!topic || !count) {
      await this.router.navigate(['/study-setup']);
      return;
    }

    this.topic = topic;
    this.studyCount = count;

    try {
      const storedCards = await this.flashcardService.getStoredFlashcards(topic, count);
      const loadedCards = storedCards ?? state?.['cards'] ?? [];
      const pendingCards = (loadedCards ?? []).filter((card: Flashcard) => !card.learned);
      this.allLearned = !pendingCards.length && !!(loadedCards?.length);
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

  get swipeDirection(): 'left' | 'right' | null {
    if (!this.isDragging || Math.abs(this.dragX) < 40) return null;
    return this.dragX > 0 ? 'right' : 'left';
  }

  async ionViewWillEnter() {
    this.currentIndex = 0;
    this.isFlipped = false;

    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state;
    const topic = state?.['topic'] as string | undefined;
    const count = state?.['count'] as number | undefined;

    if (this.cards.length && topic === this.topic) return;

    if (topic && count) {
      this.topic = topic;
      this.studyCount = count;
      const storedCards = await this.flashcardService.getStoredFlashcards(topic, count);
      const loadedCards = (storedCards ?? state?.['cards'] ?? []) as Flashcard[];
      const pendingCards = loadedCards.filter(card => !card.learned);
      this.allLearned = !pendingCards.length && !!loadedCards.length;
      this.cards = pendingCards.sort(() => Math.random() - 0.5);
      this.loading = false;
      this.loadingError = !pendingCards.length;
      this.imageLoaded = false;
    }
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
      const swipedRight = this.dragX > 0;
      const swipedCard = this.currentCard;
      this.dragX = swipedRight ? 500 : -500;
      if (swipedRight && swipedCard) {
        this.flashcardService.markAsLearned(this.topic, this.studyCount, swipedCard.word);
      }
      setTimeout(() => {
        this.dragX = 0;
        this.dragY = 0;
        this.next();
      }, 250);
    } else {
      this.dragX = 0;
      this.dragY = 0;
    }
  }

  flip() {
    this.isFlipped = !this.isFlipped;

    if (this.flipSpeakTimer) {
      clearTimeout(this.flipSpeakTimer);
      this.flipSpeakTimer = undefined;
    }

    if (this.isFlipped) {
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
    if (this.flipSpeakTimer) {
      clearTimeout(this.flipSpeakTimer);
      this.flipSpeakTimer = undefined;
    }

    if (this.currentIndex < this.cards.length - 1) {
      this.currentIndex++;
      this.isFlipped = false;
      this.imageLoaded = false;
    } else {
      this.router.navigate(['/study-setup']);
    }
  }

  speak(word: string) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    synthesizer.cancel();
    synthesizer.resume();
    const utterance = new SpeechSynthesisUtterance(word.trim());
    utterance.rate = 0.85;
    utterance.lang = 'en-US';
    const englishVoice = synthesizer.getVoices()
      .find(voice => voice.lang.toLowerCase().startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    synthesizer.speak(utterance);
  }

  onImageLoaded() {
    this.imageLoaded = true;
  }

  private speakCurrentCard() {
    const card = this.currentCard;
    if (card) {
      this.speak(card.word);
    }
  }

}
