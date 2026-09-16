import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  IonContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonButton,
  IonIcon,
  IonSpinner,
  IonActionSheet
} from '@ionic/angular/standalone';
import {
  bookOutline,
  checkmarkCircle,
  bookmarkOutline,
  sparklesOutline,
  arrowForwardOutline,
  restaurantOutline,
  airplaneOutline,
  pawOutline,
  briefcaseOutline,
  medkitOutline,
  barbellOutline,
  musicalNotesOutline,
  laptopOutline,
  homeOutline,
  shirtOutline,
  cloudOutline,
  cashOutline,
  colorPaletteOutline,
  flaskOutline,
  languageOutline,
  cartOutline,
  schoolOutline,
  leafOutline,
  carOutline,
  peopleOutline
} from 'ionicons/icons';
import { FlashcardService, TopicResult } from 'src/app/services/flashcard';

interface Topic {
  id: string;
  label: string;
  icon: string;
  fromLocal: boolean;
}

@Component({
  selector: 'app-study-setup',
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonButton,
    IonIcon,
    IonSpinner,
    IonActionSheet,
    FormsModule
  ],
  templateUrl: './study-setup.page.html',
  styleUrls: ['./study-setup.page.scss'],
})
export class StudySetupPage implements OnInit {
  topics: Topic[] = [];
  loadingTopics = true;
  topicsError = false;
  loadingMoreTopics = false;
  moreTopicsError = false;
  loadingCards = false;
  cardsError = false;
  topicMenuOpen = false;
  topicToDelete: Topic | null = null;
  private topicPressTimer?: ReturnType<typeof setTimeout>;
  private ignoreNextTopicClick = false;

  selectedTopic: string | null = null;
  cardCount: number = 10;

  constructor(
    private router: Router,
    private flashcardService: FlashcardService
  ) {
    addIcons({
      bookOutline, checkmarkCircle, bookmarkOutline, sparklesOutline,
      arrowForwardOutline,
      restaurantOutline, airplaneOutline, pawOutline, briefcaseOutline,
      medkitOutline, barbellOutline, musicalNotesOutline, laptopOutline,
      homeOutline, shirtOutline, cloudOutline, cashOutline, colorPaletteOutline,
      flaskOutline, languageOutline, cartOutline, schoolOutline, leafOutline,
      carOutline, peopleOutline
    });
  }

  private static readonly ICON_MAP: ReadonlyArray<readonly [RegExp, string]> = [
    [/(comida|cocin|receta|gastronom|food|cook|meal|restaurant)/i, 'restaurant-outline'],
    [/(viaje|viajar|ciudad|país|pais|destino|cultura|travel|trip|country)/i, 'airplane-outline'],
    [/(animal|mascota|naturaleza|planta|pet|nature)/i, 'paw-outline'],
    [/(negocio|empresa|trabajo|oficina|profesi[oó]n|business|work|office)/i, 'briefcase-outline'],
    [/(cuerpo|salud|m[eé]dico|doctor|enfermedad|body|health|medical)/i, 'medkit-outline'],
    [/(deporte|ejercicio|gimnasio|f[uú]tbol|sport|exercise|gym)/i, 'barbell-outline'],
    [/(m[uú]sica|canci[oó]n|instrumento|music|song)/i, 'musical-notes-outline'],
    [/(tecnolog|comput|c[oó]digo|programaci[oó]n|internet|tech|code)/i, 'laptop-outline'],
    [/(familia|hogar|casa|family|home|house)/i, 'home-outline'],
    [/(ropa|moda|fashion|clothes)/i, 'shirt-outline'],
    [/(clima|tiempo|lluvia|sol|weather|climate)/i, 'cloud-outline'],
    [/(dinero|finanz|precio|econom|money|finance|price)/i, 'cash-outline'],
    [/(arte|pintura|dibujo|dise[ñn]o|art|paint|draw)/i, 'color-palette-outline'],
    [/(ciencia|qu[ií]mica|biolog|f[ií]sica|science|space)/i, 'flask-outline'],
    [/(idioma|lenguaje|gram[aá]tica|vocabulario|language|grammar)/i, 'language-outline'],
    [/(compra|tienda|mercado|shopping|shop|store)/i, 'cart-outline'],
    [/(escuela|educaci[oó]n|estudio|aprend|school|education|study)/i, 'school-outline'],
    [/(ecolog|ambient|sosten|ecology|environment)/i, 'leaf-outline'],
    [/(coche|auto|carro|transporte|veh[ií]culo|car|transport)/i, 'car-outline'],
    [/(gente|persona|amigo|social|people|friend)/i, 'people-outline']
  ];

  private pickIcon(label: string): string {
    for (const [pattern, icon] of StudySetupPage.ICON_MAP) {
      if (pattern.test(label)) return icon;
    }
    return 'book-outline';
  }

  async ngOnInit() {
    try {
      const result: TopicResult = await this.flashcardService.getTopics();
      if (result.topics.length) {
        this.topics = result.topics.map(label => ({
          id: this.toTopicId(label),
          label,
          icon: this.pickIcon(label),
          fromLocal: result.fromLocal
        }));
      } else {
        this.topicsError = true;
      }
    } catch (error) {
      console.error('No se pudieron cargar los temas de Gemini', error);
      this.topicsError = true;
    } finally {
      this.loadingTopics = false;
    }
  }

  private toTopicId(label: string): string {
    return label
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  selectTopic(topicId: string) {
    if (this.ignoreNextTopicClick) {
      this.ignoreNextTopicClick = false;
      return;
    }
    this.selectedTopic = this.selectedTopic === topicId ? null : topicId;
  }

  startTopicPress(topic: Topic) {
    this.cancelTopicPress();
    if (!topic.fromLocal) return;

    this.topicPressTimer = setTimeout(() => {
      this.ignoreNextTopicClick = true;
      this.topicToDelete = topic;
      this.topicMenuOpen = true;
    }, 600);
  }

  cancelTopicPress() {
    if (this.topicPressTimer) {
      clearTimeout(this.topicPressTimer);
      this.topicPressTimer = undefined;
    }
  }

  closeTopicMenu() {
    this.topicMenuOpen = false;
    this.topicToDelete = null;
  }

  async deleteSelectedTopic() {
    const topic = this.topicToDelete;
    this.closeTopicMenu();
    if (topic) await this.deleteTopic(topic);
  }

  async deleteTopic(topic: Topic) {
    if (!confirm(`¿Eliminar el tema "${topic.label}" y sus tarjetas guardadas?`)) return;

    try {
      await this.flashcardService.deleteTopic(topic.label);
      this.topics = this.topics.filter(item => item.id !== topic.id);
      if (this.selectedTopic === topic.id) {
        this.selectedTopic = null;
      }
    } catch (error) {
      console.error('No se pudo eliminar el tema', error);
    }
  }

  async loadMoreTopics() {
    if (this.loadingMoreTopics) return;

    this.loadingMoreTopics = true;
    this.moreTopicsError = false;

    try {
      const labels = await this.flashcardService.getMoreTopics(this.topics.map(topic => topic.label));
      const localTopics = this.topics.filter(topic => topic.fromLocal);
      const suggestedTopics = labels.map(label => ({
        id: this.toTopicId(label),
        label,
        icon: this.pickIcon(label),
        fromLocal: false
      }));

      this.topics = [...localTopics, ...suggestedTopics];
      if (this.selectedTopic && !this.topics.some(topic => topic.id === this.selectedTopic)) {
        this.selectedTopic = null;
      }
    } catch (error) {
      console.error('No se pudieron cargar más temas de Gemini', error);
      this.moreTopicsError = true;
    } finally {
      this.loadingMoreTopics = false;
    }
  }

  async startStudy() {
    if (!this.selectedTopic) return;

    const topic = this.topics.find(item => item.id === this.selectedTopic);
    if (!topic) return;

    this.loadingCards = true;
    this.cardsError = false;

    try {
      const cards = await this.flashcardService.generateFlashcards(topic.label, this.cardCount);
      await this.router.navigate(['/flashcards'], {
        state: { topic: topic.label, count: this.cardCount, cards },
      });
    } catch (error) {
      console.error('No se pudieron generar las tarjetas', error);
      this.cardsError = true;
    } finally {
      this.loadingCards = false;
    }
  }

}
