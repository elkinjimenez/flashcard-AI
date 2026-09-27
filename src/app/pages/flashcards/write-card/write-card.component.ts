import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmark, imageOutline, volumeHighOutline } from 'ionicons/icons';
import { Flashcard } from 'src/app/services/flashcard';
import { isSameWord, isTypo, normalizeAnswer } from 'src/app/services/word-forms';

type WriteState = 'idle' | 'correct' | 'wrong';
// exact: la palabra tal cual. close: otra forma (jumps por jump) o una errata, que también valen.
type Match = 'exact' | 'close' | null;

export interface WriteAnswer {
  knew: boolean;
  // Valió, pero no tal cual: hay que enseñarle cómo se escribe.
  corrected: boolean;
}

const defaultMessage = 'Escribe la palabra que muestra la imagen.';

// Ejercicio de escritura: ver la imagen y escribir la palabra, sin pistas. Dos intentos; una errata o
// otra forma de la palabra valen, pero se enseña cómo se escribe.
@Component({
  selector: 'app-write-card',
  standalone: true,
  imports: [CommonModule, FormsModule, IonButton, IonIcon],
  templateUrl: './write-card.component.html',
  styleUrls: ['./write-card.component.scss'],
})
export class WriteCardComponent implements OnChanges {
  @Input({ required: true }) card!: Flashcard;
  // Cambia en cada aparición de una tarjeta: reinicia el ejercicio.
  @Input({ required: true }) round!: number;
  @Output() answered = new EventEmitter<WriteAnswer>();
  @Output() speak = new EventEmitter<void>();
  // No cargó la imagen: sin ella no hay nada que escribir.
  @Output() imageError = new EventEmitter<void>();
  @ViewChild('answerInput') private answerInput?: ElementRef<HTMLInputElement>;

  state: WriteState = 'idle';
  answer = '';
  message = defaultMessage;
  // Lo último que escribió, si no era la palabra exacta.
  typed = '';
  imageLoaded = false;
  imageFailed = false;
  private attempts = 0;
  private readonly maxAttempts = 2;

  constructor() {
    addIcons({ checkmark, imageOutline, volumeHighOutline });
  }

  get done(): boolean {
    return this.state !== 'idle';
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['round']) {
      this.state = 'idle';
      this.answer = '';
      this.message = defaultMessage;
      this.typed = '';
      this.attempts = 0;
      // Solo con teclado físico: en el móvil, abrir el teclado sin tocar taparía la imagen.
      if (matchMedia('(pointer: fine)').matches) {
        setTimeout(() => this.answerInput?.nativeElement.focus({ preventScroll: true }));
      }
    }
    if (changes['card']) {
      this.imageLoaded = false;
      this.imageFailed = false;
    }
  }

  check() {
    const typed = this.answer.trim();
    if (this.done || !typed) return;

    const match = this.match(typed);
    if (match) {
      this.typed = match === 'close' ? typed : '';
      this.finish(true, match === 'close');
      return;
    }

    this.attempts++;
    this.typed = typed;
    if (this.attempts >= this.maxAttempts) {
      this.finish(false);
      return;
    }
    this.message = `No es «${typed}». Te queda un intento.`;
    // Lista para corregir o escribir otra encima.
    setTimeout(() => this.answerInput?.nativeElement.select());
  }

  // No lo sé (desde la barra de la página): muestra la palabra y cuenta como fallo.
  giveUp() {
    if (this.done) return;
    this.finish(false);
  }

  onImageError() {
    this.imageFailed = true;
    if (!this.done) {
      this.imageError.emit();
    }
  }

  private finish(knew: boolean, corrected = false) {
    this.state = knew ? 'correct' : 'wrong';
    this.answered.emit({ knew, corrected });
  }

  private match(typed: string): Match {
    const word = normalizeAnswer(this.card.word);
    const full = normalizeAnswer(typed);
    // "the apple", "to run": el artículo o el to del infinitivo sobran.
    const answers = [full, full.replace(/^(a|an|the|to) /, '')];

    if (answers.includes(word)) return 'exact';
    return answers.some(answer => this.isOtherForm(answer, word) || isTypo(answer, word)) ? 'close' : null;
  }

  // En las de varias palabras cada una puede llevar su terminación ("ice creams", "getting up").
  private isOtherForm(answer: string, word: string): boolean {
    const answerWords = answer.split(' ');
    const wordParts = word.split(' ');
    return answerWords.length === wordParts.length && answerWords.every((part, i) => isSameWord(part, wordParts[i]));
  }
}
