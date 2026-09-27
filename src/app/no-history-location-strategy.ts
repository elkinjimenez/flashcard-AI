import { Injectable } from '@angular/core';
import { PathLocationStrategy } from '@angular/common';

// Toda la app ocupa una sola entrada del historial: atrás / adelante del sistema no salta entre pestañas ni vuelve a una
// sesión ya terminada (su entrada guardaría sus tarjetas). Se vuelve con los controles de la app (flecha de la práctica,
// deslizar atrás de Ionic). No sirve replaceUrl: con él, Ionic destruye la vista de la pestaña que se deja.
@Injectable()
export class NoHistoryLocationStrategy extends PathLocationStrategy {
  override pushState(state: unknown, title: string, url: string, queryParams: string): void {
    this.replaceState(state, title, url, queryParams);
  }
}
