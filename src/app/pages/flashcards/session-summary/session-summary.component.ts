import { Component, EventEmitter, Input, OnChanges, OnInit, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowUndoOutline, arrowUp, bookOutline, checkmark, flame, imageOutline, star, timeOutline
} from 'ionicons/icons';
import { Flashcard, learnedBox } from 'src/app/services/flashcard.model';
import { Streak, wordStageLabel } from 'src/app/services/stats';
import { MiniStory } from 'src/app/services/gemini';
import { MiniStoryComponent } from '../mini-story/mini-story.component';
import { CardImageDirective } from 'src/app/card-image.directive';
import { AnswerFeedbackService } from 'src/app/services/answer-feedback';

// Cómo le fue a una palabra en la sesión (o en la ronda de difíciles).
export interface SummaryWord {
  // Como quedó guardada, con la imagen que se ve en la sesión.
  card: Flashcard;
  // Como estaba al empezar.
  before: Flashcard;
  // Se falló al menos una vez.
  hard: boolean;
}

export interface SessionStreak extends Streak {
  // La sesión sumó un día: fue la primera práctica de hoy.
  grew: boolean;
  // Y con él supera el récord de antes.
  record: boolean;
}

export interface SessionSummary {
  knew: number;
  hard: number;
  // Llegan cuando terminan de guardarse las respuestas; undefined mientras tanto o si no se pudieron leer.
  words?: SummaryWord[];
  streak?: SessionStreak;
}

// De la mejor a la que más cuesta: así se ordena la lista.
type Outcome = 'learned' | 'up' | 'same' | 'hard';
const outcomeOrder: Outcome[] = ['learned', 'up', 'same', 'hard'];

interface WordRow {
  card: Flashcard;
  outcome: Outcome;
  // Puntos del medidor: la caja de Leitner, hasta la de aprendida.
  level: number;
  levelBefore: number;
  status: string;
  returns: string;
}

// Palabras que se piden para la historia, primero las difíciles (las que más la necesitan): con muchas más saldría
// forzada o demasiado larga.
const maxStoryWords = 12;
const dayMs = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-session-summary',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon, CardImageDirective],
  templateUrl: './session-summary.component.html',
  styleUrls: ['./session-summary.component.scss'],
})
export class SessionSummaryComponent implements OnInit, OnChanges {
  private modalController = inject(ModalController);
  private feedback = inject(AnswerFeedbackService);

  @Input({ required: true }) summary!: SessionSummary;
  // Para la mini-historia.
  @Input({ required: true }) topic!: string;
  @Output() reviewHard = new EventEmitter<void>();
  // Volver a la última tarjeta para cambiar la respuesta.
  @Output() undo = new EventEmitter<void>();
  @Output() exit = new EventEmitter<void>();

  readonly dots = Array.from({ length: learnedBox }, (_, index) => index);
  // Las chispas de la celebración: su dirección y color van en el SCSS (ver $spark-count).
  readonly sparks = Array.from({ length: 12 });
  rows: WordRow[] = [];
  levelUps = 0;
  // La que ya se escribió: al volver a abrirla no se pide otra.
  private story: MiniStory | null = null;

  constructor() {
    addIcons({ arrowUndoOutline, arrowUp, bookOutline, checkmark, flame, imageOutline, star, timeOutline });
  }

  // Con la celebración, una vibración breve de éxito donde la haya (ver AnswerFeedbackService).
  ngOnInit() {
    this.feedback.sessionFinished();
  }

  ngOnChanges() {
    const now = new Date();
    this.rows = (this.summary.words ?? [])
      .map(word => this.toRow(word, now))
      .sort((a, b) => outcomeOrder.indexOf(a.outcome) - outcomeOrder.indexOf(b.outcome));
    this.levelUps = this.rows.filter(row => row.outcome === 'learned' || row.outcome === 'up').length;
  }

  // Sin días seguidos (p. ej. si solo marcó palabras como ya conocidas, que no cuentan) no se muestra.
  get streak(): SessionStreak | null {
    return this.summary.streak?.current ? this.summary.streak : null;
  }

  get streakNote(): string {
    const streak = this.streak;
    if (!streak) return '';
    if (streak.grew && streak.current === 1) return '¡Empieza hoy!';
    if (streak.record) return '¡Nuevo récord!';
    if (streak.grew) return '+1 hoy';
    return `Récord: ${streak.best}`;
  }

  async openStory() {
    const words = [...this.rows].reverse().slice(0, maxStoryWords).map(row => row.card.word);
    const modal = await this.modalController.create({
      component: MiniStoryComponent,
      componentProps: { topic: this.topic, words, story: this.story }
    });
    await modal.present();
    const { data } = await modal.onWillDismiss<MiniStory | null>();
    this.story = data ?? this.story;
  }

  levelLabel(row: WordRow): string {
    return `Nivel ${row.level} de ${learnedBox}`;
  }

  private toRow({ card, before, hard }: SummaryWord, now: Date): WordRow {
    const level = Math.min(card.box ?? 0, learnedBox);
    const levelBefore = Math.min(before.box ?? 0, learnedBox);
    const outcome: Outcome = hard
      ? 'hard'
      : card.learned && !before.learned ? 'learned' : level > levelBefore ? 'up' : 'same';

    return {
      card,
      outcome,
      level,
      levelBefore,
      status: outcome === 'hard' ? 'A reforzar' : outcome === 'learned' ? '¡Aprendida!' : wordStageLabel(card),
      returns: this.describeReturn(card.nextReview, now)
    };
  }

  // Por días de calendario: lo que vuelve a primera hora de mañana vuelve "mañana", aunque falten menos de 24 h.
  private describeReturn(nextReview: string | undefined, now: Date): string {
    if (!nextReview) return '';
    const days = Math.round((this.startOfDay(new Date(nextReview)) - this.startOfDay(now)) / dayMs);
    if (days <= 0) return 'Vuelve en tu próximo repaso';
    if (days === 1) return 'Vuelve mañana';
    if (days < 7) return `Vuelve en ${days} días`;
    if (days < 30) {
      const weeks = Math.round(days / 7);
      return `Vuelve en ${weeks} ${weeks === 1 ? 'semana' : 'semanas'}`;
    }
    const months = Math.round(days / 30);
    return `Vuelve en ${months} ${months === 1 ? 'mes' : 'meses'}`;
  }

  private startOfDay(date: Date): number {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result.getTime();
  }
}
