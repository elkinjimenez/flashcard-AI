import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline, imageOutline, sparkles, volumeHighOutline } from 'ionicons/icons';
import { Flashcard } from 'src/app/services/flashcard';
import { wordPattern } from 'src/app/services/word-forms';
import { CardImageDirective } from 'src/app/card-image.directive';

// Presentación de una palabra nueva: imagen, palabra, pronunciación y ejemplo, sin preguntar nada.
// Su primer ejercicio llega unas tarjetas después (ver planSession en la página).
@Component({
  selector: 'app-intro-card',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon, CardImageDirective],
  templateUrl: './intro-card.component.html',
  styleUrls: ['./intro-card.component.scss'],
})
export class IntroCardComponent implements OnChanges {
  @Input({ required: true }) card!: Flashcard;
  @Output() speak = new EventEmitter<void>();
  // Ya la conocía: la página la pasa a repaso sin practicarla ahora.
  @Output() known = new EventEmitter<void>();

  // Oculta hasta que se pide, como en el dorso de la tarjeta: se aprende por la imagen, no traduciendo.
  showTranslation = false;
  // Por URL: entre dos presentaciones seguidas el componente es el mismo, y con la misma imagen no vuelve a emitir load.
  private loadedUrl = '';
  private failedUrl = '';

  constructor() {
    addIcons({ eyeOffOutline, eyeOutline, imageOutline, sparkles, volumeHighOutline });
  }

  ngOnChanges(changes: SimpleChanges) {
    // Otra palabra (no la misma con la imagen cambiada): la traducción vuelve a ocultarse.
    const previous = changes['card']?.previousValue as Flashcard | undefined;
    if (previous?.word !== this.card.word) {
      this.showTranslation = false;
    }
  }

  get imageReady(): boolean {
    return this.loadedUrl === this.card.imageUrl;
  }

  get imageUnavailable(): boolean {
    return !this.card.imageUrl || this.failedUrl === this.card.imageUrl;
  }

  // Frase de ejemplo partida para resaltar la palabra: los trozos en posición impar son la palabra.
  get exampleParts(): string[] {
    return this.card.example ? this.card.example.split(wordPattern(this.card.word)) : [];
  }

  onImageLoad(url: string) {
    this.loadedUrl = url;
  }

  onImageError(url: string) {
    this.failedUrl = url;
  }
}
