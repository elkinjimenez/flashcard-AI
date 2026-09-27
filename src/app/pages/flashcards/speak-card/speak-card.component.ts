import { Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { bulbOutline, imageOutline, mic, volumeHighOutline } from 'ionicons/icons';
import { Flashcard } from 'src/app/services/flashcard';
import { SpeechRecognitionError, SpeechRecognitionService } from 'src/app/services/speech-recognition';
import { isSameWord, normalizeAnswer, wordPattern } from 'src/app/services/word-forms';

// blocked: sin micrófono o sin permiso.
type SpeakState = 'idle' | 'listening' | 'blocked' | 'correct' | 'wrong';
// blocked: sin micrófono o sin permiso. declined: ahora no puede hablar.
export type SpeechUnavailableReason = 'blocked' | 'declined';
// exact: la palabra tal cual. close: otra forma de ella (jumping por jump), que también vale.
type Match = 'exact' | 'close' | null;

interface Hint {
  label: string;
  text: string;
  // Letras sueltas ("j _ _ _"): se respetan los espacios.
  letters?: boolean;
}

const defaultMessage = 'Toca el micrófono y di la palabra en inglés.';

// Ejercicio de habla: ver la imagen y decir la palabra. Dos intentos; los fallos del reconocimiento (no oír nada,
// sin conexión) no gastan intento. Si la imagen no basta, hay pistas que se destapan de una en una (si se permiten).
@Component({
  selector: 'app-speak-card',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon],
  templateUrl: './speak-card.component.html',
  styleUrls: ['./speak-card.component.scss'],
})
export class SpeakCardComponent implements OnChanges, OnDestroy {
  private speech = inject(SpeechRecognitionService);

  @Input({ required: true }) card!: Flashcard;
  // Cambia en cada aparición de una tarjeta: reinicia el ejercicio.
  @Input({ required: true }) round!: number;
  // Sin pistas cuando la palabra ya está avanzada: hay que decirla de memoria.
  @Input() hintsAllowed = true;
  @Output() answered = new EventEmitter<boolean>();
  @Output() speak = new EventEmitter<void>();
  // Sin micrófono o si ahora no puede hablar: la página deja de sortear este ejercicio.
  @Output() unavailable = new EventEmitter<SpeechUnavailableReason>();
  // No cargó la imagen: sin ella no hay nada que decir.
  @Output() imageError = new EventEmitter<void>();

  state: SpeakState = 'idle';
  message = defaultMessage;
  // Lo que entendió el reconocimiento, para mostrarlo si no coincide o si valió otra forma de la palabra.
  heard = '';
  hints: Hint[] = [];
  hintsShown = 0;
  imageLoaded = false;
  imageFailed = false;
  private attempts = 0;
  private readonly maxAttempts = 2;

  constructor() {
    addIcons({ bulbOutline, imageOutline, mic, volumeHighOutline });
  }

  get done(): boolean {
    return this.state === 'correct' || this.state === 'wrong';
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['round']) {
      this.speech.stop();
      this.state = 'idle';
      this.message = defaultMessage;
      this.heard = '';
      this.attempts = 0;
      this.hintsShown = 0;
    }
    if (changes['card']) {
      this.imageLoaded = false;
      this.imageFailed = false;
      this.hints = this.buildHints(this.card);
    }
  }

  ngOnDestroy() {
    this.speech.stop();
  }

  async listen() {
    if (this.state !== 'idle') return;

    const round = this.round;
    this.state = 'listening';
    try {
      const transcripts = await this.speech.listen();
      // La tarjeta cambió mientras escuchaba (p. ej. deshacer), o se respondió con No lo sé.
      if (round !== this.round || this.done) return;
      this.evaluate(transcripts);
    } catch (error) {
      if (round !== this.round || this.done) return;
      this.handleError(error);
    }
  }

  onImageError() {
    this.imageFailed = true;
    if (!this.done) {
      this.speech.stop();
      this.imageError.emit();
    }
  }

  // No lo sé (desde la barra de la página): muestra la palabra y cuenta como fallo.
  giveUp() {
    if (this.done) return;
    this.speech.stop();
    this.finish(false);
  }

  showHint() {
    this.hintsShown = Math.min(this.hintsShown + 1, this.hints.length);
  }

  declineSpeaking() {
    this.speech.stop();
    this.unavailable.emit('declined');
  }

  private evaluate(transcripts: string[]) {
    if (!transcripts.some(Boolean)) {
      this.state = 'idle';
      this.message = 'No te oí. Toca el micrófono e inténtalo otra vez.';
      return;
    }

    const matches = transcripts.map(transcript => this.match(transcript));
    if (matches.includes('exact')) {
      this.heard = '';
      this.finish(true);
      return;
    }
    const close = matches.indexOf('close');
    if (close >= 0) {
      this.heard = transcripts[close];
      this.finish(true);
      return;
    }

    this.attempts++;
    this.heard = transcripts[0];
    if (this.attempts >= this.maxAttempts) {
      this.finish(false);
      return;
    }
    this.state = 'idle';
    this.message = `Oí «${this.heard}». Inténtalo otra vez.`;
  }

  private finish(knew: boolean) {
    this.state = knew ? 'correct' : 'wrong';
    this.answered.emit(knew);
  }

  private handleError(error: unknown) {
    const code = error instanceof SpeechRecognitionError ? error.code : '';
    this.state = 'idle';

    if (['not-allowed', 'service-not-allowed', 'audio-capture', 'not-supported'].includes(code)) {
      this.state = 'blocked';
      this.message = 'No hay acceso al micrófono. Permítelo en el navegador para practicar.';
      this.unavailable.emit('blocked');
    } else if (code === 'network') {
      this.message = 'Hace falta conexión para reconocer la voz. Inténtalo otra vez.';
    } else if (code === 'aborted') {
      this.message = defaultMessage;
    } else {
      this.message = 'No te oí. Toca el micrófono e inténtalo otra vez.';
    }
  }

  // Busca la palabra dentro de lo dicho ("the apple"), sin fijarse en mayúsculas, tildes ni guiones.
  // En las de varias palabras cada una puede llevar su terminación ("ice creams", "getting up").
  private match(transcript: string): Match {
    const target = normalizeAnswer(this.card.word).split(' ').filter(Boolean);
    const heard = normalizeAnswer(transcript).split(' ').filter(Boolean);
    if (!target.length) return null;
    if (heard.join('') === target.join('')) return 'exact';

    let result: Match = null;
    for (let i = 0; i + target.length <= heard.length; i++) {
      const words = heard.slice(i, i + target.length);
      if (words.every((word, j) => word === target[j])) return 'exact';
      if (words.every((word, j) => isSameWord(word, target[j]))) result = 'close';
    }
    return result;
  }

  // De menos a más reveladora: qué significa, la palabra en una frase y cómo se escribe.
  private buildHints(card: Flashcard): Hint[] {
    const hints: Hint[] = [];
    if (card.translation) {
      hints.push({ label: 'Significa', text: card.translation });
    }
    // Solo si la frase lleva la palabra: sin nada que tapar podría traerla en forma irregular (ran por run).
    const example = card.example?.replace(wordPattern(card.word), '___');
    if (example && example !== card.example) {
      hints.push({ label: 'En una frase', text: example });
    }
    hints.push({ label: 'Empieza así', text: this.letterPattern(card.word), letters: true });
    return hints;
  }

  // "jump" → "j _ _ _"; en las de varias palabras, la primera letra de cada una.
  private letterPattern(word: string): string {
    return word.trim().split(/\s+/)
      .map(part => [...part].map((char, i) => i > 0 && /[a-z]/i.test(char) ? '_' : char).join(' '))
      .join('   ');
  }

}
