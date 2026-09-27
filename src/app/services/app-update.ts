import { Injectable } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { addIcons } from 'ionicons';
import { refresh } from 'ionicons/icons';
import { ToastService } from './toast';

// Detecta las versiones nuevas desplegadas y las aplica cuando el usuario lo pide.
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private versionReady = false;
  private checking = false;

  constructor(private swUpdate: SwUpdate, private toast: ToastService) {
    addIcons({ refresh });
  }

  init() {
    if (!this.swUpdate.isEnabled) return;

    // Sin recarga automática: se perdería lo que el usuario tenga a medias.
    this.swUpdate.versionUpdates.subscribe(event => {
      if (event.type !== 'VERSION_READY') return;
      this.versionReady = true;
      this.offerNewVersion();
    });
    this.swUpdate.unrecoverable.subscribe(() => document.location.reload());

    this.checkForUpdate();

    // En iOS la PWA no se reinicia al "cerrarla": solo se suspende y se reanuda sin pasar por aquí.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.versionReady) this.offerNewVersion();
      this.checkForUpdate();
    });
  }

  // Para un botón "Recargar": si no hay versión nueva, recarga igual.
  async updateAndReload() {
    try {
      if (this.swUpdate.isEnabled && await this.swUpdate.checkForUpdate()) {
        await this.apply();
        return;
      }
    } catch (error) {
      console.error('No se pudo buscar una versión nueva', error);
    }
    document.location.reload();
  }

  // Si el SW ya tenía la versión nueva descargada, checkForUpdate da false pero esta ventana sigue en la anterior.
  // Si da true, se encarga el aviso de VERSION_READY.
  async switchToNewVersion() {
    if (!this.swUpdate.isEnabled) return;

    try {
      if (!await this.swUpdate.checkForUpdate() && await this.swUpdate.activateUpdate()) {
        document.location.reload();
      }
    } catch (error) {
      console.error('No se pudo pasar a la versión nueva', error);
    }
  }

  private async offerNewVersion() {
    const accepted = await this.toast.show('Nueva versión disponible', {
      button: 'Actualizar',
      icon: 'refresh',
      duration: 8000
    });
    if (accepted) await this.apply();
  }

  private async apply() {
    await this.swUpdate.activateUpdate();
    document.location.reload();
  }

  private async checkForUpdate() {
    if (this.checking) return;

    this.checking = true;
    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      console.error('No se pudo buscar una versión nueva', error);
    } finally {
      this.checking = false;
    }
  }
}
