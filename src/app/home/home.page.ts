import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowForwardOutline, sparklesOutline } from 'ionicons/icons';
import { pickWordOfTheDay } from './word-of-the-day';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [RouterLink, IonContent, IonButton, IonIcon],
})
export class HomePage {
  readonly wordOfTheDay = pickWordOfTheDay();

  constructor() {
    addIcons({ arrowForwardOutline, sparklesOutline });
  }
}
