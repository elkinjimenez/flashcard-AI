import { Component, Input, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSpinner, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline, stopCircleOutline, volumeHighOutline } from 'ionicons/icons';
import { GeminiService, MiniStory } from 'src/app/services/gemini';
import { loadEnglishLevel } from 'src/app/services/english-level';
import { PronunciationService } from 'src/app/services/pronunciation';
import { describeRequestError } from 'src/app/services/request-error';

// Historia corta con las palabras de la sesión, para verlas en contexto al terminar. Se abre con ModalController; al
// cerrarse devuelve la historia, para no volver a pedirla si se abre otra vez (se pasa en `story`).
@Component({
  selector: 'app-mini-story',
  standalone: true,
  imports: [CommonModule, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSpinner, IonIcon],
  templateUrl: './mini-story.component.html',
  styleUrls: ['./mini-story.component.scss'],
})
export class MiniStoryComponent implements OnInit, OnDestroy {
  private gemini = inject(GeminiService);
  private modalController = inject(ModalController);
  private pronunciation = inject(PronunciationService);

  @Input({ required: true }) topic!: string;
  @Input({ required: true }) words!: string[];
  @Input() story: MiniStory | null = null;

  // Sin síntesis de voz no se ofrece escucharla.
  readonly canListen = 'speechSynthesis' in window;
  loading = false;
  error = '';
  showTranslation = false;
  speaking = false;
  // Párrafos partidos para resaltar las palabras de la sesión: los trozos en posición impar son esas palabras.
  paragraphs: string[][] = [];
  translationParagraphs: string[] = [];
  // Sube en cada lectura: la que termina tarde no apaga el botón de la siguiente.
  private reading = 0;

  constructor() {
    addIcons({ eyeOffOutline, eyeOutline, stopCircleOutline, volumeHighOutline });
  }

  ngOnInit() {
    if (this.story) {
      this.show(this.story);
    } else {
      this.load();
    }
  }

  ngOnDestroy() {
    this.stopReading();
  }

  async load() {
    this.loading = true;
    this.error = '';
    try {
      const story = await this.gemini.writeStory(this.topic, this.words, loadEnglishLevel());
      if (story) {
        this.show(story);
      } else {
        this.error = 'La IA no pudo escribir la historia. Intenta nuevamente.';
      }
    } catch (error) {
      console.error('No se pudo crear la mini-historia', error);
      this.error = `No se pudo crear la historia. ${describeRequestError(error)}`;
    } finally {
      this.loading = false;
    }
  }

  async toggleReading() {
    if (this.speaking) {
      this.stopReading();
      return;
    }
    if (!this.story) return;

    const reading = ++this.reading;
    this.speaking = true;
    await this.pronunciation.speakText(this.story.story);
    if (reading === this.reading) {
      this.speaking = false;
    }
  }

  speakWord(word: string) {
    this.stopReading();
    this.pronunciation.speak(word);
  }

  close() {
    this.modalController.dismiss(this.story, 'close');
  }

  private stopReading() {
    if (!this.speaking) return;
    this.reading++;
    this.speaking = false;
    this.pronunciation.stop();
  }

  private show(story: MiniStory) {
    this.story = story;
    // Las más largas primero, para que "ice cream" gane a "ice". Con sus terminaciones ("apples"), como en wordPattern.
    const alternatives = [...this.words]
      .sort((a, b) => b.length - a.length)
      .map(word => word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter(Boolean);
    const pattern = alternatives.length ? new RegExp(`(\\b(?:${alternatives.join('|')})\\w*)`, 'gi') : null;
    this.paragraphs = this.splitParagraphs(story.story).map(paragraph => pattern ? paragraph.split(pattern) : [paragraph]);
    this.translationParagraphs = this.splitParagraphs(story.translation);
  }

  private splitParagraphs(text: string): string[] {
    return text.split(/\n+/).map(paragraph => paragraph.trim()).filter(Boolean);
  }
}
