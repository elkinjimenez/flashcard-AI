import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons,
  IonButton, IonIcon, IonProgressBar, IonSpinner
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { volumeHighOutline, arrowForwardOutline, arrowBackOutline } from 'ionicons/icons';
import { Flashcard, FlashcardService } from 'src/app/services/flashcard';

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
    IonSpinner
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
  imageLoaded = false;
  topic = '';
  private flipSpeakTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private router: Router,
    private flashcardService: FlashcardService
  ) {
    addIcons({ volumeHighOutline, arrowForwardOutline, arrowBackOutline });
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

    try {
      this.cards = state?.['cards']
        ?? await this.flashcardService.getStoredFlashcards(topic, count);
      this.loadingError = !this.cards?.length;
      this.cards = this.cards ?? [];
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

  ionViewWillEnter() {
    this.currentIndex = 0;
    this.isFlipped = false;

    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state;
    const nextCards = state?.['cards'] as Flashcard[] | undefined;

    if (nextCards?.length && nextCards !== this.cards) {
      this.cards = nextCards;
      this.loading = false;
      this.loadingError = false;
      this.imageLoaded = false;
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
