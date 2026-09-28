import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  IonContent, IonSpinner, IonIcon, IonButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  barbellOutline, bulbOutline, chevronForward, imageOutline, statsChartOutline, volumeHighOutline
} from 'ionicons/icons';
import { DailyActivity } from 'src/app/services/study-set-repository';
import { HardWord, Stats, StatsService, TopicStats, wordStages } from 'src/app/services/stats';
import { count } from 'src/app/services/count';
import { FlashcardService } from 'src/app/services/flashcard';
import { DayChangeService } from 'src/app/services/day-change';
import { mnemonicMisses } from 'src/app/services/flashcard.model';
import { loadEnglishLevel } from 'src/app/services/english-level';
import { PronunciationService } from 'src/app/services/pronunciation';
import { describeRequestError } from 'src/app/services/request-error';
import { toTopicKey } from 'src/app/services/topic-key';
import { ToastService } from 'src/app/services/toast';
import { CardImageDirective } from 'src/app/card-image.directive';

const weekdayInitials = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const weekdayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const todayIndex = 6;

@Component({
  selector: 'app-stats',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    IonContent, IonSpinner, IonIcon, IonButton,
    CardImageDirective
  ],
  templateUrl: './stats.page.html',
  styleUrls: ['./stats.page.scss'],
})
export class StatsPage {
  private router = inject(Router);
  private statsService = inject(StatsService);
  private flashcardService = inject(FlashcardService);
  private toast = inject(ToastService);
  private pronunciation = inject(PronunciationService);

  // En orden de avance: la barra de "Tus palabras" las apila así, de la más clara a la más oscura.
  readonly stages = wordStages;
  readonly todayIndex = todayIndex;
  readonly mnemonicMisses = mnemonicMisses;
  readonly count = count;
  stats: Stats | null = null;
  loading = true;
  loadingError = false;
  // Día de la semana cuyo detalle se muestra bajo el gráfico.
  selectedDay = todayIndex;
  // Palabras cuyo truco está creando la IA.
  creatingMnemonics = new Set<HardWord>();
  // Se está preparando la práctica de las que más cuestan.
  practicingHard = false;

  constructor() {
    addIcons({ barbellOutline, bulbOutline, chevronForward, imageOutline, statsChartOutline, volumeHighOutline });
    merge(this.flashcardService.cardsChanged, inject(DayChangeService).dayChanged)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.load());
  }

  speak(item: HardWord) {
    this.pronunciation.speak(item.word);
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

  get practiceHardLabel(): string {
    const count = this.stats?.hardestWords.length ?? 0;
    return count === 1 ? 'Practicar esta palabra' : `Practicar estas ${count} palabras`;
  }

  // Una sesión con las de la lista, aunque aún no les toque repaso: acertarlas no adelanta su calendario (ver
  // applyAnswer), fallarlas sí cuenta.
  async practiceHard() {
    const words = this.stats?.hardestWords ?? [];
    if (this.practicingHard || !words.length) return;

    this.practicingHard = true;
    try {
      const session = await this.flashcardService.prepareWords(words, loadEnglishLevel());
      if (!session.cards.length) {
        await this.load();
        return;
      }
      await this.router.navigate(['/flashcards'], {
        state: { ...session, title: 'Las que más te cuestan', returnUrl: '/tabs/progress' }
      });
    } catch (error) {
      console.error('No se pudo preparar la práctica', error);
      this.toast.show(`No se pudo preparar la práctica. ${describeRequestError(error)}`, { color: 'danger', duration: 5000 });
    } finally {
      this.practicingHard = false;
    }
  }

  // En cada visita, al terminar una sesión de práctica y al empezar un día nuevo: los números cambian.
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
    return stats ? wordStages.map(stage => `${stage.plural}: ${stats.stages[stage.id]}`).join(', ') : '';
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

  // Parte del tema que son `count` palabras, para su medidor.
  topicPercent(topic: TopicStats, count: number): number {
    return count / topic.total * 100;
  }

  // Para abrir la lista de sus palabras.
  topicKey(topic: TopicStats): string {
    return toTopicKey(topic.topic);
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
