import { Injectable, NgZone, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { toDayKey } from './day-key';

// Avisa cuando empieza un día nuevo (hora local) con la app abierta: cambian los repasos que tocan, la racha y la fecha.
// Las pestañas no se enteran solas: en iOS la PWA no se cierra, solo se suspende, y al reanudarla al día siguiente no
// vuelven a recibir ionViewWillEnter.
@Injectable({ providedIn: 'root' })
export class DayChangeService {
  private zone = inject(NgZone);

  readonly dayChanged = new Subject<void>();
  private day = toDayKey(new Date());

  constructor() {
    // Al volver a la app (reanudarla, desbloquear el móvil, volver a su pestaña) y a medianoche, si sigue a la vista.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.check();
    });
    this.scheduleMidnightCheck();
  }

  private check() {
    const today = toDayKey(new Date());
    if (today === this.day) return;
    this.day = today;
    this.dayChanged.next();
  }

  // Un segundo pasada la medianoche, por si el temporizador se adelanta; con el dispositivo dormido llega tarde, pero al
  // volver a la app ya se comprueba. Fuera de Angular: un temporizador de horas pendiente no la dejaría nunca estable.
  private scheduleMidnightCheck() {
    const midnight = new Date();
    midnight.setHours(24, 0, 1, 0);
    this.zone.runOutsideAngular(() => setTimeout(() => {
      this.zone.run(() => this.check());
      this.scheduleMidnightCheck();
    }, midnight.getTime() - Date.now()));
  }
}
