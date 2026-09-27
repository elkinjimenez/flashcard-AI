import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { provideHttpClient } from '@angular/common/http';
import { isDevMode } from '@angular/core';
import { LocationStrategy } from '@angular/common';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { NoHistoryLocationStrategy } from './app/no-history-location-strategy';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LocationStrategy, useClass: NoHistoryLocationStrategy },
    // iOS también en Android: la barra de vidrio y el deslizar atrás entre páginas son de este estilo.
    provideIonicAngular({ mode: 'ios' }),
    provideHttpClient(),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerImmediately',
    }),
  ],
});
