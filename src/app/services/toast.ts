import { Injectable } from '@angular/core';
import { ToastController } from '@ionic/angular/standalone';

export interface ToastOptions {
  color?: 'danger' | 'dark' | 'primary';
  // Texto del botón de acción.
  button?: string;
  icon?: string;
  duration?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private current?: HTMLIonToastElement;

  constructor(private toastController: ToastController) {}

  // Resuelve al cerrarse: true si se tocó el botón. Un toast nuevo cierra el anterior.
  async show(message: string, { color = 'dark', button, icon, duration = 3000 }: ToastOptions = {}): Promise<boolean> {
    const toast = await this.toastController.create({
      message,
      duration,
      position: 'top',
      color,
      icon,
      buttons: button ? [{ text: button, role: 'action' }] : undefined
    });

    const previous = this.current;
    this.current = toast;
    previous?.dismiss();

    await toast.present();
    const { role } = await toast.onDidDismiss();
    if (this.current === toast) this.current = undefined;
    return role === 'action';
  }
}
