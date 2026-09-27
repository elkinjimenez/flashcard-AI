import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowForwardOutline, arrowUndoOutline, checkmark, checkmarkCircle, close, eyeOutline, refreshCircle
} from 'ionicons/icons';

// Lo que ofrece la barra: voltear la tarjeta, calificarla, rendirse en un ejercicio o continuar tras responderlo.
export type ActionMode = 'flip' | 'rate' | 'give-up' | 'continue';

// Barra de abajo de la práctica: solo lo que toca hacer ahora; tras responder un ejercicio se tiñe con el resultado.
// La página decide qué toca y qué hace cada botón.
@Component({
  selector: 'app-action-bar',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon],
  templateUrl: './action-bar.component.html',
  styleUrls: ['./action-bar.component.scss'],
})
export class ActionBarComponent {
  @Input({ required: true }) mode!: ActionMode;
  // Resultado del ejercicio; null mientras no se responde.
  @Input() result: boolean | null = null;
  @Input() canUndo = false;
  // Con acierto, Continuar se va llenando durante este tiempo antes de avanzar solo; 0: espera al botón.
  @Input() autoAdvanceMs = 0;
  @Output() flip = new EventEmitter<void>();
  // true: La sé; false: Difícil.
  @Output() rate = new EventEmitter<boolean>();
  @Output() giveUp = new EventEmitter<void>();
  @Output() advance = new EventEmitter<void>();
  @Output() undo = new EventEmitter<void>();

  constructor() {
    addIcons({ arrowForwardOutline, arrowUndoOutline, checkmark, checkmarkCircle, close, eyeOutline, refreshCircle });
  }
}
