import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton } from '@ionic/angular/standalone';

export interface SessionSummary {
  knew: number;
  hard: number;
  skipped: number;
}

@Component({
  selector: 'app-session-summary',
  standalone: true,
  imports: [CommonModule, IonButton],
  templateUrl: './session-summary.component.html',
  styleUrls: ['./session-summary.component.scss'],
})
export class SessionSummaryComponent {
  @Input({ required: true }) summary!: SessionSummary;
  @Output() reviewHard = new EventEmitter<void>();
  @Output() exit = new EventEmitter<void>();

  get message(): string {
    if (this.summary.hard) return 'Repásalas ahora; también volverán en tus próximos repasos.';
    if (this.summary.knew) return 'Volverán cuando toque repasarlas.';
    return 'Las saltadas volverán en tu próxima sesión.';
  }
}
