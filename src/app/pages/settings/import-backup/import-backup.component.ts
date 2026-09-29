import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent, IonFooter, IonHeader, IonIcon, IonToolbar, ModalController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { clipboardOutline } from 'ionicons/icons';
import { BackupError, BackupService } from 'src/app/services/backup';
import { ToastService } from 'src/app/services/toast';

// Pegar un respaldo para importarlo. Se abre con CardModalService: devuelve el respaldo leído. Si el texto no sirve,
// sigue abierto para corregirlo sin volver a pegarlo.
@Component({
  selector: 'app-import-backup',
  standalone: true,
  imports: [FormsModule, IonHeader, IonToolbar, IonContent, IonFooter, IonIcon],
  templateUrl: './import-backup.component.html',
})
export class ImportBackupComponent {
  private backup = inject(BackupService);
  private modalController = inject(ModalController);
  private toast = inject(ToastService);

  @ViewChild('input') private input?: ElementRef<HTMLTextAreaElement>;

  text = '';
  reading = false;

  constructor() {
    addIcons({ clipboardOutline });
  }

  get canImport(): boolean {
    return !!this.text.trim() && !this.reading;
  }

  // Ya abierto, listo para pegar.
  ionViewDidEnter() {
    this.input?.nativeElement.focus();
  }

  async import() {
    if (!this.canImport) return;

    this.reading = true;
    try {
      const backup = await this.backup.parse(this.text);
      this.modalController.dismiss(backup, 'confirm');
    } catch (error) {
      console.error('No se pudo leer el respaldo', error);
      const message = error instanceof BackupError ? error.message : 'No se pudo leer el respaldo.';
      this.toast.show(message, { color: 'danger', duration: 5000 });
    } finally {
      this.reading = false;
    }
  }

  cancel() {
    this.modalController.dismiss(null, 'cancel');
  }
}
