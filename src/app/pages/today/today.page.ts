import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowForwardOutline, flame, volumeHighOutline } from 'ionicons/icons';
import { FlashcardService } from 'src/app/services/flashcard';
import { Stats, StatsService, TopicStats } from 'src/app/services/stats';
import { loadEnglishLevel } from 'src/app/services/english-level';
import { registerTopicIcons, topicIcon } from 'src/app/services/topic-icon';
import { describeRequestError } from 'src/app/services/request-error';
import { ToastService } from 'src/app/services/toast';
import { pickWordOfTheDay } from 'src/app/home/word-of-the-day';
import { PronunciationService } from 'src/app/services/pronunciation';

// Como mucho, los repasos de una sesión: igual que la sesión más larga que se puede elegir en Temas.
const maxReviewSession = 20;

// Lo de hoy: la racha, los repasos que tocan (cada tema con su botón para repasarlos) y la palabra del día.
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

  readonly wordOfTheDay = pickWordOfTheDay();
  // "sábado, 27 de septiembre".
  readonly dateLabel = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  stats: Stats | null = null;
  loading = true;
  loadingError = false;
  // Tema cuya sesión se está preparando.
  reviewing: string | null = null;

  constructor() {
    addIcons({ arrowForwardOutline, flame, volumeHighOutline });
    registerTopicIcons();
    this.flashcardService.cardsChanged.pipe(takeUntilDestroyed()).subscribe(() => this.load());
  }

  // En cada visita y al terminar una sesión de práctica.
  ionViewWillEnter() {
    return this.load();
  }

  // Los que más repasos tienen, primero.
  get dueTopics(): TopicStats[] {
    return (this.stats?.topics ?? []).filter(topic => topic.due).sort((a, b) => b.due - a.due);
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
    return stats.dueTomorrow
      ? `Mañana te esperan ${this.count(stats.dueTomorrow, 'repaso', 'repasos')}. Mientras, puedes aprender palabras nuevas.`
      : 'No tienes repasos pendientes. Puedes aprender palabras nuevas.';
  }

  get streak(): number {
    return this.stats?.streak ?? 0;
  }

  get streakLabel(): string {
    const streak = this.streak;
    return streak ? `${this.count(streak, 'día', 'días')} de racha` : 'Practica hoy para empezar tu racha';
  }

  speakWordOfTheDay() {
    this.pronunciation.speak(this.wordOfTheDay.word);
  }

  icon(topic: TopicStats): string {
    return topicIcon(topic.topic);
  }

  count(value: number, singular: string, plural: string): string {
    return `${value} ${value === 1 ? singular : plural}`;
  }

  // Sesión con los repasos que tocan del tema (van antes que las palabras nuevas, ver prepareSession).
  async review(topic: TopicStats) {
    if (this.reviewing) return;

    this.reviewing = topic.topic;
    try {
      const count = Math.min(topic.due, maxReviewSession);
      const cards = await this.flashcardService.prepareSession(topic.topic, count, loadEnglishLevel());
      if (!cards.length) {
        await this.load();
        return;
      }
      await this.router.navigate(['/flashcards'], { state: { topic: topic.topic, cards, returnUrl: '/tabs/today' } });
    } catch (error) {
      console.error('No se pudo preparar el repaso', error);
      this.toast.show(`No se pudo preparar el repaso. ${describeRequestError(error)}`, { color: 'danger', duration: 5000 });
    } finally {
      this.reviewing = null;
    }
  }

  private async load() {
    this.loadingError = false;
    try {
      this.stats = await this.statsService.getStats();
    } catch (error) {
      console.error('No se pudieron cargar los repasos de hoy', error);
      this.loadingError = true;
    } finally {
      this.loading = false;
    }
  }
}
