import { Injectable, inject } from '@angular/core';
import { first } from 'rxjs';
import { FlashcardService } from './flashcard';
import { StudySetRepository } from './study-set-repository';

// 'persisted': el navegador no borrará los datos aunque le falte espacio. 'best-effort': podría borrarlos.
// 'unsupported': el navegador no permite pedirlo.
export type StoragePersistence = 'persisted' | 'best-effort' | 'unsupported';

// Los temas, el progreso y la racha solo están en IndexedDB. Sin almacenamiento persistente, el navegador puede
// borrarlos cuando le falta espacio. Chrome y Safari lo conceden o no sin preguntar (más fácil con la app instalada);
// Firefox pregunta.
@Injectable({ providedIn: 'root' })
export class StoragePersistenceService {
  private studySets = inject(StudySetRepository);
  private flashcards = inject(FlashcardService);

  // Al abrir la app si ya hay temas y, si no, tras la primera práctica: sin nada guardado, el aviso de Firefox no se
  // entendería. En cada arranque, porque Chrome puede concederlo más adelante (p. ej. al instalar la app); si ya está
  // concedido no se pide otra vez.
  init() {
    this.studySets.getAll()
      .then(studySets => studySets.length ? this.request() : false)
      .catch(error => console.warn('No se pudo comprobar si hay temas guardados', error));
    this.flashcards.cardsChanged.pipe(first()).subscribe(() => this.request());
  }

  // true si queda persistente. No falla: si no se concede, los datos siguen guardados como siempre.
  async request(): Promise<boolean> {
    try {
      if (!navigator.storage?.persist) return false;
      return await navigator.storage.persisted() || await navigator.storage.persist();
    } catch (error) {
      console.warn('No se pudo pedir almacenamiento persistente', error);
      return false;
    }
  }

  async status(): Promise<StoragePersistence> {
    if (!navigator.storage?.persisted) return 'unsupported';
    try {
      return await navigator.storage.persisted() ? 'persisted' : 'best-effort';
    } catch (error) {
      console.warn('No se pudo saber si el almacenamiento es persistente', error);
      return 'best-effort';
    }
  }
}
