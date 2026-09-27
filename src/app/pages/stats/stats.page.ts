import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  IonContent, IonSpinner, IonIcon, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { bulbOutline, imageOutline, statsChartOutline } from 'ionicons/icons';
import { DailyActivity } from 'src/app/services/study-set-repository';
import { HardWord, Stats, StatsService, TopicStats, WordStage } from 'src/app/services/stats';
import { FlashcardService } from 'src/app/services/flashcard';
import { mnemonicMisses } from 'src/app/services/flashcard.model';
import { describeRequestError } from 'src/app/services/request-error';
import { ToastService } from 'src/app/services/toast';

const weekdayInitials = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const weekdayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

// En orden de avance: la barra de "Tus palabras" las apila así, de la más clara a la más oscura.
const stages: { id: WordStage; label: string }[] = [
  { id: 'new', label: 'Nuevas' },
  { id: 'learning', label: 'Aprendiendo' },
  { id: 'consolidating', label: 'Afianzadas' },
  { id: 'learned', label: 'Aprendidas' },
];

const todayIndex = 6;

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    IonContent, IonSpinner, IonIcon, IonButton
  ],
  templateUrl: './stats.page.html',
  styleUrls: ['./stats.page.scss'],
})
export class StatsPage {
  private statsService = inject(StatsService);
  private flashcardService = inject(FlashcardService);
  private toast = inject(ToastService);

  readonly stages = stages;
  readonly todayIndex = todayIndex;
  readonly mnemonicMisses = mnemonicMisses;
  stats: Stats | null = null;
  loading = true;
  loadingError = false;
  // Día de la semana cuyo detalle se muestra bajo el gráfico.
  selectedDay = todayIndex;
  // Palabras cuyo truco está creando la IA.
  creatingMnemonics = new Set<HardWord>();

  constructor() {
    addIcons({ bulbOutline, imageOutline, statsChartOutline });
    this.flashcardService.sessionEnded.pipe(takeUntilDestroyed()).subscribe(() => this.load());
  }

  // Normalmente se crea al fallarla en la práctica; las que ya costaban antes de existir el truco lo piden aquí.
  canCreateMnemonic(item: HardWord): boolean {
    return item.mnemonic === undefined && item.misses >= mnemonicMisses;
  }

  async createMnemonic(item: HardWord) {
    if (this.creatingMnemonics.has(item)) return;

    this.creatingMnemonics.add(item);
    try {
      item.mnemonic = await this.flashcardService.getMnemonic(item.topic, item);
      if (!item.mnemonic) {
        this.toast.show(`La IA no encontró un truco para «${item.word}».`);
      }
    } catch (error) {
      console.error('No se pudo crear el truco para recordarla', error);
      this.toast.show(`No se pudo crear el truco. ${describeRequestError(error)}`, { color: 'danger', duration: 5000 });
    } finally {
      this.creatingMnemonics.delete(item);
    }
  }

  // En cada visita y al terminar una sesión de práctica: los números cambian.
  ionViewWillEnter() {
    return this.load();
  }

  private async load() {
    this.loadingError = false;
    try {
      this.stats = await this.statsService.getStats();
      this.selectedDay = todayIndex;
    } catch (error) {
      console.error('No se pudieron calcular las estadísticas', error);
      this.loadingError = true;
    } finally {
      this.loading = false;
    }
  }

  get weekAnswers(): number {
    return this.stats?.week.reduce((sum, day) => sum + day.answers, 0) ?? 0;
  }

  get weekAccuracy(): string {
    const accuracy = this.stats?.weekAccuracy;
    return accuracy == null ? '—' : this.percent(accuracy);
  }

  get stagesDescription(): string {
    const stats = this.stats;
    return stats ? stages.map(stage => `${stage.label}: ${stats.stages[stage.id]}`).join(', ') : '';
  }

  // La más alta llega al 85 %: encima queda sitio para su número.
  barHeight(day: DailyActivity): number {
    const max = Math.max(0, ...(this.stats?.week ?? []).map(item => item.answers));
    return max ? day.answers / max * 85 : 0;
  }

  dayLabel(day: DailyActivity, index: number): string {
    return index === todayIndex ? 'Hoy' : weekdayInitials[this.parseDay(day.date).getDay()];
  }

  dayDescription(day: DailyActivity, index: number): string {
    const date = this.parseDay(day.date);
    const name = index === todayIndex ? 'Hoy'
      : index === todayIndex - 1 ? 'Ayer'
      : `${weekdayNames[date.getDay()]} ${date.getDate()}`;
    if (!day.answers) return `${name}: sin práctica`;
    return `${name}: ${this.count(day.answers, 'respuesta', 'respuestas')}, ${this.percent(day.correct / day.answers)} de aciertos`;
  }

  topicPercent(topic: TopicStats): number {
    return topic.known / topic.total * 100;
  }

  count(value: number, singular: string, plural: string): string {
    return `${value} ${value === 1 ? singular : plural}`;
  }

  private percent(value: number): string {
    return `${Math.round(value * 100)} %`;
  }

  // AAAA-MM-DD como fecha local (new Date('AAAA-MM-DD') la tomaría como UTC y podría caer en el día anterior).
  private parseDay(key: string): Date {
    const [year, month, day] = key.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
}
