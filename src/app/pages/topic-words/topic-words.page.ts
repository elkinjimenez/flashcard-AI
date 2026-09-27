import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ActionSheetController, AlertController, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonSearchbar,
  IonSpinner, IonTitle, IonToolbar, NavController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBackOutline, ellipsisHorizontal, imageOutline } from 'ionicons/icons';
import { Flashcard, FlashcardService } from 'src/app/services/flashcard';
import { WordStage, wordStage } from 'src/app/services/stats';
import { normalizeAnswer } from 'src/app/services/word-forms';
import { ToastService } from 'src/app/services/toast';

const stageLabels: Record<WordStage, string> = {
  new: 'Nueva',
  learning: 'Aprendiendo',
  consolidating: 'Afianzada',
  learned: 'Aprendida',
};

// Desde cuántas palabras aparece el buscador.
const searchFrom = 8;

// Lo que se puede hacer con una palabra desde su menú.
type WordAction = 'edit' | 'learned' | 'delete';

// Todas las palabras de un tema guardado: corregir una traducción, marcar una como sabida o borrar una que no sirve.
// Ocupa toda la pantalla, como la práctica, y vuelve a la pestaña que la abrió.
@Component({
  selector: 'app-topic-words',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonIcon, IonSearchbar, IonSpinner
  ],
  templateUrl: './topic-words.page.html',
  styleUrls: ['./topic-words.page.scss'],
})
export class TopicWordsPage {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private navController = inject(NavController);
  private flashcardService = inject(FlashcardService);
  private actionSheetController = inject(ActionSheetController);
  private alertController = inject(AlertController);
  private toast = inject(ToastService);

  readonly searchFrom = searchFrom;
  topic = '';
  words: Flashcard[] = [];
  loading = true;
  loadingError = false;
  // El tema ya no está guardado (p. ej. se eliminó en otra pestaña del navegador).
  notFound = false;
  query = '';
  private returnUrl = '/tabs/topics';

  constructor() {
    addIcons({ arrowBackOutline, ellipsisHorizontal, imageOutline });
  }

  async ionViewWillEnter() {
    const state = this.router.getCurrentNavigation()?.extras.state
      ?? history.state; // fallback si se recarga la página
    this.returnUrl = state?.['returnUrl'] ?? '/tabs/topics';
    this.query = '';
    this.loading = true;
    this.loadingError = false;
    try {
      await this.readWords();
    } catch (error) {
      console.error('No se pudieron cargar las palabras del tema', error);
      this.loadingError = true;
    } finally {
      this.loading = false;
    }
  }

  get learnedCount(): number {
    return this.words.filter(card => card.learned).length;
  }

  // Por orden alfabético y, si se busca algo, solo las que lo contienen en inglés o en español.
  get visibleWords(): Flashcard[] {
    const query = normalizeAnswer(this.query);
    return this.words
      .filter(card => !query || normalizeAnswer(`${card.word} ${card.translation}`).includes(query))
      .sort((a, b) => a.word.localeCompare(b.word, 'en', { sensitivity: 'base' }));
  }

  stageOf(card: Flashcard): WordStage {
    return wordStage(card);
  }

  stageLabel(card: Flashcard): string {
    return stageLabels[wordStage(card)];
  }

  // Tras releer la lista las tarjetas son otros objetos: así no se vuelven a cargar sus imágenes.
  trackByWord(_: number, card: Flashcard): string {
    return card.word;
  }

  onSearch(event: Event) {
    this.query = (event as CustomEvent<{ value?: string | null }>).detail.value ?? '';
  }

  exit() {
    this.navController.navigateBack(this.returnUrl);
  }

  async openWordMenu(card: Flashcard) {
    const sheet = await this.actionSheetController.create({
      header: `${card.word} · ${card.translation}`,
      buttons: [
        { text: 'Editar traducción', data: 'edit' satisfies WordAction },
        ...(card.learned ? [] : [{ text: 'Marcar como sabida', data: 'learned' satisfies WordAction }]),
        { text: 'Eliminar palabra', role: 'destructive', data: 'delete' satisfies WordAction },
        { text: 'Cancelar', role: 'cancel' }
      ]
    });
    await sheet.present();
    const { data } = await sheet.onDidDismiss<WordAction>();

    if (data === 'edit') await this.editTranslation(card);
    if (data === 'learned') await this.markLearned(card);
    if (data === 'delete') await this.deleteWord(card);
  }

  private async editTranslation(card: Flashcard) {
    const alert = await this.alertController.create({
      header: card.word,
      subHeader: 'Traducción al español',
      inputs: [{
        name: 'translation',
        type: 'text',
        value: card.translation,
        placeholder: 'Traducción',
        attributes: { maxlength: 80, autocapitalize: 'off', enterkeyhint: 'done' }
      }],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        // Vacía no se puede guardar: el diálogo sigue abierto.
        { text: 'Guardar', role: 'confirm', handler: (values: { translation?: string }) => !!values.translation?.trim() }
      ]
    });
    await alert.present();
    const { data, role } = await alert.onDidDismiss<{ values: { translation?: string } }>();

    const translation = data?.values.translation?.trim();
    if (role !== 'confirm' || !translation || translation === card.translation) return;

    await this.change('No se pudo guardar la traducción.', () =>
      this.flashcardService.editTranslation(this.topic, card.word, translation));
  }

  private async markLearned(card: Flashcard) {
    const record = await this.change('No se pudo marcar como sabida.', () =>
      this.flashcardService.markLearned(this.topic, card.word));
    if (!record) return;

    if (await this.showUndo(`«${card.word}» pasa a aprendidas. Volverá en un repaso de mantenimiento.`)) {
      await this.change('No se pudo deshacer.', () => this.flashcardService.undoAnswer(this.topic, record));
    }
  }

  private async deleteWord(card: Flashcard) {
    const deleted = await this.change('No se pudo eliminar la palabra.', () =>
      this.flashcardService.deleteWord(this.topic, card.word));
    if (!deleted) return;

    if (await this.showUndo(`«${card.word}» eliminada, con su progreso.`)) {
      await this.change('No se pudo deshacer.', () => this.flashcardService.restoreWord(this.topic, deleted));
    }
  }

  // Guarda un cambio, relee la lista y avisa a las pestañas. También si se deshace después de salir de la página.
  // undefined si falló.
  private async change<T>(errorMessage: string, save: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await save();
      this.flashcardService.cardsChanged.next();
      await this.readWords();
      return result;
    } catch (error) {
      console.error(errorMessage, error);
      this.toast.show(errorMessage, { color: 'danger' });
      return undefined;
    }
  }

  // Resuelve true si se tocó Deshacer.
  private showUndo(message: string): Promise<boolean> {
    return this.toast.show(message, { button: 'Deshacer', duration: 5000 });
  }

  private async readWords() {
    const studySet = await this.flashcardService.getStudySet(this.route.snapshot.paramMap.get('topic') ?? '');
    this.notFound = !studySet;
    this.topic = studySet?.topic ?? '';
    this.words = studySet?.cards ?? [];
  }
}
