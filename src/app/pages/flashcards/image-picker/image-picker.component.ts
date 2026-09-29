import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader, IonToolbar, IonContent, IonFooter, IonSearchbar, IonSpinner, IonIcon, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { checkmarkCircle, imageOutline } from 'ionicons/icons';
import { Flashcard } from 'src/app/services/flashcard';
import { ImageCandidate, KlipyService } from 'src/app/services/klipy';

// Elegir a mano la imagen de una tarjeta. Empieza con los mismos candidatos que al crearla; si ninguno sirve, se
// busca con otras palabras. Se abre con CardModalService: devuelve la URL elegida al guardar.
@Component({
  selector: 'app-image-picker',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonHeader, IonToolbar, IonContent, IonFooter, IonSearchbar, IonSpinner, IonIcon
  ],
  templateUrl: './image-picker.component.html',
  styleUrls: ['./image-picker.component.scss'],
})
export class ImagePickerComponent implements OnInit {
  private klipy = inject(KlipyService);
  private modalController = inject(ModalController);

  @Input({ required: true }) card!: Flashcard;

  query = '';
  candidates: ImageCandidate[] = [];
  // La marcada en la cuadrícula; al abrir, la actual.
  selectedUrl = '';
  loading = true;
  // Lo último que se buscó a mano, para el mensaje cuando no hay resultados.
  private searchedTerm = '';
  private searchId = 0;

  constructor() {
    addIcons({ checkmarkCircle, imageOutline });
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

  // Solo si cambia: guardar la misma no hace nada.
  get canSave(): boolean {
    return !!this.selectedUrl && this.selectedUrl !== this.card.imageUrl;
  }

  ngOnInit() {
    this.selectedUrl = this.card.imageUrl;
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

  save() {
    this.modalController.dismiss(this.selectedUrl, 'confirm');
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
