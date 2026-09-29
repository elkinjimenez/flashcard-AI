import { Component, ElementRef, Input, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonFooter, IonHeader, IonIcon, IonToolbar, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { languageOutline } from 'ionicons/icons';

// Corregir la traducción de una palabra. Se abre con CardModalService: devuelve la nueva al guardar.
@Component({
  selector: 'app-edit-translation',
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonContent, IonFooter, IonIcon],
  templateUrl: './edit-translation.component.html',
})
export class EditTranslationComponent implements OnInit {
  private modalController = inject(ModalController);

  @Input({ required: true }) word!: string;
  @Input({ required: true }) translation!: string;
  @ViewChild('input') private input?: ElementRef<HTMLInputElement>;

  value = '';

  constructor() {
    addIcons({ languageOutline });
  }

  // Vacía o igual que antes no se guarda.
  get canSave(): boolean {
    const value = this.value.trim();
    return !!value && value !== this.translation;
  }

  ngOnInit() {
    this.value = this.translation;
  }

  // Ya abierto, listo para escribir.
  ionViewDidEnter() {
    this.input?.nativeElement.focus();
  }

  save() {
    if (this.canSave) this.modalController.dismiss(this.value.trim(), 'confirm');
  }

  cancel() {
    this.modalController.dismiss(null, 'cancel');
  }
}
