import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, closeCircle, imageOutline, volumeHighOutline } from 'ionicons/icons';
import { Flashcard } from 'src/app/services/flashcard';

// pick-image: palabra → elegir su imagen. pick-word: imagen → elegir su palabra. listen: oír la palabra → elegir su imagen.
export type QuizKind = 'pick-image' | 'pick-word' | 'listen';
export type QuizOptionState = 'correct' | 'wrong' | 'dimmed' | null;

// Ejercicio de opción múltiple. Las opciones y la elección las lleva la página, igual que el resto de la sesión (deshacer, repetir difíciles).
@Component({
  selector: 'app-quiz-card',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon],
  templateUrl: './quiz-card.component.html',
  styleUrls: ['./quiz-card.component.scss'],
})
export class QuizCardComponent {
  @Input({ required: true }) kind!: QuizKind;
  @Input({ required: true }) card!: Flashcard;
  @Input({ required: true }) options!: Flashcard[];
  // null hasta que se elige una opción (y también si se respondió con No lo sé).
  @Input() choice: Flashcard | null = null;
  // Ya respondido (eligiendo o con No lo sé): se marca la correcta y las opciones dejan de responder.
  @Input() revealed = false;
  @Output() choose = new EventEmitter<Flashcard>();
  @Output() speak = new EventEmitter<void>();
  // Ahora no puede escuchar: la página deja de sortear el ejercicio de escuchar.
  @Output() declineListening = new EventEmitter<void>();
  // No cargó la imagen de la palabra (la pregunta en "elige la palabra", la opción correcta en "elige la imagen").
  @Output() imageError = new EventEmitter<void>();

  // Por URL: la misma imagen puede repetirse entre preguntas y el navegador no vuelve a emitir load.
  private loadedImages = new Set<string>();
  private failedImages = new Set<string>();

  constructor() {
    addIcons({ checkmarkCircle, closeCircle, imageOutline, volumeHighOutline });
  }

  optionState(option: Flashcard): QuizOptionState {
    if (!this.revealed) return null;
    if (option.word === this.card.word) return 'correct';
    return option === this.choice ? 'wrong' : 'dimmed';
  }

  isLoaded(url: string): boolean {
    return this.loadedImages.has(url);
  }

  isFailed(url: string): boolean {
    return this.failedImages.has(url);
  }

  onImageLoad(url: string) {
    this.loadedImages.add(url);
  }

  onImageError(url: string) {
    this.failedImages.add(url);
    if (url === this.card.imageUrl && !this.revealed) {
      this.imageError.emit();
    }
  }
}
