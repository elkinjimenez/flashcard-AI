import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { StudySetRepository } from '../services/study-set-repository';
import { hasOwnStudySets } from '../services/starter-topics';

const storageKey = 'flashcards-ai.welcomed';

// Si el almacenamiento falla (navegación privada, datos bloqueados), la bienvenida vuelve a salir.
function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function markWelcomeSeen() {
  try {
    localStorage.setItem(storageKey, 'true');
  } catch {
    // Sin almacenamiento, la próxima vez vuelve a salir.
  }
}

// La bienvenida solo sale la primera vez: después la app abre directamente en Hoy. Quien ya tiene temas suyos (de
// antes de existir la marca) tampoco la vuelve a ver; los de inicio no cuentan (ver hasOwnStudySets).
export const welcomeGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const studySets = inject(StudySetRepository);

  if (!hasSeenWelcome()) {
    try {
      if (!hasOwnStudySets(await studySets.getAll())) return true;
      markWelcomeSeen();
    } catch {
      return true;
    }
  }
  return router.createUrlTree(['/tabs/today']);
};
