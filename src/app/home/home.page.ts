import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  IonContent,
  IonButton,
  IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowForwardOutline, sparklesOutline } from 'ionicons/icons';
import { markWelcomeSeen } from './welcome';

// Bienvenida: solo sale la primera vez (ver welcomeGuard).
@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [IonContent, IonButton, IonIcon],
})
export class HomePage {
  private router = inject(Router);

  // Solo de muestra: aún no tiene palabras suyas (en Hoy, la palabra del día sale de las que le cuestan).
  readonly sampleWord = { word: 'lighthouse', translation: 'faro' };

  constructor() {
    addIcons({ arrowForwardOutline, sparklesOutline });
  }

  // A Temas: sin palabras aún, en Hoy no habría nada. replaceUrl: con el botón atrás de Android no se vuelve a la bienvenida.
  start() {
    markWelcomeSeen();
    this.router.navigate(['/tabs/topics'], { replaceUrl: true });
  }
}
