import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowUndoOutline } from 'ionicons/icons';

export interface SessionSummary {
  knew: number;
  hard: number;
}

@Component({
  selector: 'app-session-summary',
  standalone: true,
  imports: [CommonModule, IonButton, IonIcon],
  templateUrl: './session-summary.component.html',
  styleUrls: ['./session-summary.component.scss'],
})
export class SessionSummaryComponent {
  @Input({ required: true }) summary!: SessionSummary;
  @Output() reviewHard = new EventEmitter<void>();
  // Volver a la última tarjeta para cambiar la respuesta.
  @Output() undo = new EventEmitter<void>();
  @Output() exit = new EventEmitter<void>();

  constructor() {
    addIcons({ arrowUndoOutline });
  }

  get message(): string {
    if (this.summary.hard) return 'Repásalas ahora; también volverán en tus próximos repasos.';
    return 'Volverán cuando toque repasarlas.';
  }
}
