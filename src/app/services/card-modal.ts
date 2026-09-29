import { Injectable, inject } from '@angular/core';
import { ModalController, ModalOptions, isPlatform } from '@ionic/angular/standalone';

// Lo mínimo de CloseWatcher (Chrome 120+), que TypeScript aún no trae.
interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}
type WindowWithCloseWatcher = Window & { CloseWatcher?: new () => CloseWatcherLike };

// Modales en tarjeta, como en iOS: la pantalla (o el modal) de detrás se encoge y el nuevo sube encima. Se cierran
// deslizando hacia abajo, con el fondo, con el atrás de Android o desde el propio modal (ModalController.dismiss). Los
// estilos de la tarjeta y de su contenido van en theme/card-modal.scss.
@Injectable({ providedIn: 'root' })
export class CardModalService {
  private modalController = inject(ModalController);

  // Resuelve al empezar a cerrarse con lo que devolvió el modal; null si se cerró sin más (Cancelar, deslizar, atrás).
  async open<T>(component: ModalOptions['component'], componentProps?: ModalOptions['componentProps']): Promise<T | null> {
    const modal = await this.modalController.create({
      component,
      componentProps,
      cssClass: 'card-modal',
      // Encima del modal abierto, si lo hay: así se apilan.
      presentingElement: (await this.modalController.getTop()) ?? document.querySelector('ion-router-outlet') ?? undefined,
    });
    this.watchBackButton(modal);
    await modal.present();
    const { data } = await modal.onWillDismiss<T>();
    return data ?? null;
  }

  // El atrás de Android en la PWA cierra el modal en vez de salir de la app. En la app nativa ya lo hace Ionic.
  private watchBackButton(modal: HTMLIonModalElement) {
    const CloseWatcher = (window as WindowWithCloseWatcher).CloseWatcher;
    if (!CloseWatcher || isPlatform('hybrid')) return;

    const watcher = new CloseWatcher();
    watcher.onclose = () => modal.dismiss(null, 'cancel');
    modal.addEventListener('ionModalWillDismiss', () => watcher.destroy(), { once: true });
  }
}
