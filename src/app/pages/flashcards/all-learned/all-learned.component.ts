import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonButton } from '@ionic/angular/standalone';

@Component({
  selector: 'app-all-learned',
  standalone: true,
  imports: [CommonModule, IonButton],
  templateUrl: './all-learned.component.html',
  styleUrls: ['./all-learned.component.scss'],
})
export class AllLearnedComponent {
  @Output() exit = new EventEmitter<void>();
}
