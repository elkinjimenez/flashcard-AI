import { Component, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';
import { AppUpdateService } from './services/app-update';
import { ThemeService } from './services/theme';
import { StoragePersistenceService } from './services/storage-persistence';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  constructor() {
    inject(AppUpdateService).init();
    inject(ThemeService).init();
    inject(StoragePersistenceService).init();
  }
}
