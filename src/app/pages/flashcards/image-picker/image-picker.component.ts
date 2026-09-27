import { Component, Input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSearchbar, IonSpinner, IonIcon,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle } from 'ionicons/icons';
import { Flashcard } from 'src/app/services/flashcard';
import { ImageCandidate, KlipyService } from 'src/app/services/klipy';

// Elegir a mano la imagen de una tarjeta. Empieza con los mismos candidatos que al crearla; si ninguno sirve, se
// busca con otras palabras. Se abre con ModalController: devuelve la URL elegida con el rol 'confirm'.
@Component({
  selector: 'app-image-picker',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonContent, IonSearchbar, IonSpinner, IonIcon
  ],
  templateUrl: './image-picker.component.html',
  styleUrls: ['./image-picker.component.scss'],
})
export class ImagePickerComponent implements OnInit {
  @Input({ required: true }) card!: Flashcard;

  query = '';
  candidates: ImageCandidate[] = [];
  loading = true;
  // Lo último que se buscó a mano, para el mensaje cuando no hay resultados.
  private searchedTerm = '';
  private searchId = 0;

  constructor(private klipy: KlipyService, private modalController: ModalController) {
    addIcons({ checkmarkCircle });
  }

  // Ejemplo de búsqueda con la de la IA: Klipy funciona mejor con 2 o 3 palabras en inglés.
  get placeholder(): string {
    return `Busca en inglés, p. ej. "${this.card.imageQuery || this.card.word}"`;
  }

  get emptyMessage(): string {
    if (!navigator.onLine) return 'Sin conexión: no se pudieron buscar imágenes.';
    return this.searchedTerm
      ? `No hay imágenes para "${this.searchedTerm}". Prueba con otras palabras.`
      : 'No se encontraron imágenes. Prueba a buscar con otras palabras.';
  }

  ngOnInit() {
    return this.show(this.klipy.searchCandidates([this.card]).then(([candidates]) => candidates));
  }

  search() {
    const term = this.query.trim();
    if (!term) return;

    this.searchedTerm = term;
    return this.show(this.klipy.searchImages(term));
  }

  isCurrent(candidate: ImageCandidate): boolean {
    return candidate.url === this.card.imageUrl;
  }

  choose(candidate: ImageCandidate) {
    this.modalController.dismiss(candidate.url, 'confirm');
  }

  cancel() {
    this.modalController.dismiss(null, 'cancel');
  }

  // Solo la última búsqueda: una anterior que llegue tarde no pisa sus resultados.
  private async show(request: Promise<ImageCandidate[]>) {
    const id = ++this.searchId;
    this.loading = true;
    const candidates = await request;
    if (id !== this.searchId) return;

    this.candidates = candidates;
    this.loading = false;
  }
}
