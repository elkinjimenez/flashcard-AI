import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowForwardOutline, checkmarkCircle, flagOutline, flame, shuffleOutline, volumeHighOutline } from 'ionicons/icons';
import { Flashcard, FlashcardService, MixedReview } from 'src/app/services/flashcard';
import { DayChangeService } from 'src/app/services/day-change';
import { Stats, StatsService, TopicStats } from 'src/app/services/stats';
import { loadEnglishLevel } from 'src/app/services/english-level';
import { DailyGoal, loadDailyGoal } from 'src/app/services/daily-goal';
import { NewWordsLimit, loadNewWordsLimit } from 'src/app/services/new-words-limit';
import { registerTopicIcons, topicIcon } from 'src/app/services/topic-icon';
import { describeRequestError } from 'src/app/services/request-error';
import { ToastService } from 'src/app/services/toast';
import { DailyWord, pickWordOfTheDay } from './word-of-the-day';
import { PronunciationService } from 'src/app/services/pronunciation';
import { count } from 'src/app/services/count';

// Como mucho, los repasos de una sesión: igual que la sesión más larga que se puede elegir en Temas.
const maxReviewSession = 20;

// La sesión que se está preparando es el repaso de todos los temas.
const allTopics = Symbol('allTopics');

// "sábado, 27 de septiembre".
const dateFormat = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' });

// Lo de hoy: la racha, la meta diaria, los repasos que tocan (cada tema con su botón para repasarlos, y con varios
// temas uno para repasarlos todos mezclados) y la palabra del día.
@Component({
  selector: 'app-today',
  standalone: true,
  imports: [CommonModule, RouterLink, IonContent, IonButton, IonIcon, IonSpinner],
  templateUrl: './today.page.html',
  styleUrls: ['./today.page.scss'],
})
export class TodayPage {
  private router = inject(Router);
  private flashcardService = inject(FlashcardService);
  private statsService = inject(StatsService);
  private toast = inject(ToastService);
  private pronunciation = inject(PronunciationService);

  readonly count = count;
  // Sale de las palabras que más le cuestan; sin ninguna, no se muestra.
  wordOfTheDay: DailyWord | null = null;
  // Se actualiza en cada carga: la app puede seguir abierta al día siguiente.
  dateLabel = dateFormat.format(new Date());
  stats: Stats | null = null;
  // Se elige en Ajustes: se vuelve a leer en cada carga.
  dailyGoal: DailyGoal = loadDailyGoal();
  newWordsLimit: NewWordsLimit = loadNewWordsLimit();
  loading = true;
  loadingError = false;
  // Tema cuya sesión se está preparando, o allTopics.
  reviewing: string | typeof allTopics | null = null;

  constructor() {
    addIcons({ arrowForwardOutline, checkmarkCircle, flagOutline, flame, shuffleOutline, volumeHighOutline });
    registerTopicIcons();
    merge(this.flashcardService.cardsChanged, inject(DayChangeService).dayChanged)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.load());
  }

  // En cada visita, al terminar una sesión de práctica y al empezar un día nuevo.
  ionViewWillEnter() {
    return this.load();
  }

  // Los que más repasos tienen, primero.
  get dueTopics(): TopicStats[] {
    return (this.stats?.topics ?? []).filter(topic => topic.due).sort((a, b) => b.due - a.due);
  }

  get reviewingAll(): boolean {
    return this.reviewing === allTopics;
  }

  // Si son más de los que caben en una sesión, dice cuántos entran: los más atrasados.
  get reviewAllLabel(): string {
    const due = this.stats?.dueToday ?? 0;
    return due > maxReviewSession ? `Repasar ${maxReviewSession} de ${due}` : `Repasar todo (${due})`;
  }

  get title(): string {
    const stats = this.stats;
    if (!stats) return 'Hoy';
    if (!stats.totalWords) return 'Empieza a aprender';
    return stats.dueToday ? `Tienes ${this.count(stats.dueToday, 'repaso', 'repasos')}` : 'Estás al día';
  }

  get intro(): string {
    const stats = this.stats;
    if (!stats) return '';
    if (!stats.totalWords) return 'Elige un tema y crea tus primeras tarjetas: aquí verás cada día lo que te toca repasar.';
    if (stats.dueToday) return 'Repasarlas a tiempo es lo que hace que no se olviden.';
    // Con el tope de palabras nuevas alcanzado no invita a aprender más.
    if (!this.newWordsLeft) {
      return stats.dueTomorrow
        ? `Ya empezaste tus palabras nuevas de hoy. Mañana te esperan ${this.count(stats.dueTomorrow, 'repaso', 'repasos')}.`
        : 'Ya empezaste tus palabras nuevas de hoy. Mañana podrás empezar más.';
    }
    return stats.dueTomorrow
      ? `Mañana te esperan ${this.count(stats.dueTomorrow, 'repaso', 'repasos')}. Mientras, puedes aprender palabras nuevas.`
      : 'No tienes repasos pendientes. Puedes aprender palabras nuevas.';
  }

  // Las que aún se pueden empezar hoy, según el tope de Ajustes.
  get newWordsLeft(): number {
    const started = this.stats?.week[this.stats.week.length - 1]?.newWords ?? 0;
    return Math.max(0, this.newWordsLimit - started);
  }

  get streak(): number {
    return this.stats?.streak ?? 0;
  }

  get streakLabel(): string {
    const streak = this.streak;
    return streak ? `${this.count(streak, 'día', 'días')} de racha` : 'Practica hoy para empezar tu racha';
  }

  // Las de hoy: el último día de la semana de las estadísticas.
  get answersToday(): number {
    return this.stats?.week[this.stats.week.length - 1]?.answers ?? 0;
  }

  get goalReached(): boolean {
    return this.answersToday >= this.dailyGoal;
  }

  get goalPercent(): number {
    return Math.min(100, this.answersToday * 100 / this.dailyGoal);
  }

  get goalLabel(): string {
    return this.goalReached ? 'Meta de hoy cumplida' : `${this.answersToday} de ${this.dailyGoal} respuestas hoy`;
  }

  speakWordOfTheDay() {
    if (this.wordOfTheDay) this.pronunciation.speak(this.wordOfTheDay.word);
  }

  icon(topic: TopicStats): string {
    return topicIcon(topic.topic);
  }

  // Sesión con los repasos que tocan del tema (van antes que las palabras nuevas, ver prepareSession).
  review(topic: TopicStats) {
    return this.startReview(topic.topic, async () => {
      const count = Math.min(topic.due, maxReviewSession);
      return { topic: topic.topic, cards: await this.flashcardService.prepareSession(topic.topic, count, loadEnglishLevel()) };
    });
  }

  // Los repasos de todos los temas en una sesión, mezclados: alternar temas obliga a distinguir cada palabra de las
  // demás, no solo de las de su tema, y se recuerdan mejor.
  reviewAll() {
    return this.startReview(allTopics, () =>
      this.flashcardService.prepareMixedReview(maxReviewSession, loadEnglishLevel()));
  }

  private async startReview(
    reviewing: string | typeof allTopics,
    prepare: () => Promise<{ topic: string; cards: Flashcard[] } | MixedReview>
  ) {
    if (this.reviewing) return;

    this.reviewing = reviewing;
    try {
      const session = await prepare();
      if (!session.cards.length) {
        await this.load();
        return;
      }
      await this.router.navigate(['/flashcards'], { state: { ...session, returnUrl: '/tabs/today' } });
    } catch (error) {
      console.error('No se pudo preparar el repaso', error);
      this.toast.show(`No se pudo preparar el repaso. ${describeRequestError(error)}`, { color: 'danger', duration: 5000 });
    } finally {
      this.reviewing = null;
    }
  }

  private async load() {
    this.dateLabel = dateFormat.format(new Date());
    this.dailyGoal = loadDailyGoal();
    this.newWordsLimit = loadNewWordsLimit();
    this.loadingError = false;
    try {
      this.stats = await this.statsService.getStats();
      this.wordOfTheDay = pickWordOfTheDay(this.stats.hardestWords);
    } catch (error) {
      console.error('No se pudieron cargar los repasos de hoy', error);
      this.loadingError = true;
    } finally {
      this.loading = false;
    }
  }
}
