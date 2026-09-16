import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: 'study-setup',
    loadComponent: () => import('./pages/study-setup/study-setup.page').then( m => m.StudySetupPage)
  },
  {
    path: 'flashcards',
    loadComponent: () => import('./pages/flashcards/flashcards.page').then( m => m.FlashcardsPage)
  },
];
