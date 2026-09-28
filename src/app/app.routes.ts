import { Routes } from '@angular/router';
import { welcomeGuard } from './home/welcome';

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
    canActivate: [welcomeGuard],
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  // Pantallas principales, con la barra de pestañas.
  {
    path: 'tabs',
    loadComponent: () => import('./tabs/tabs.page').then(m => m.TabsPage),
    children: [
      {
        path: 'today',
        loadComponent: () => import('./pages/today/today.page').then(m => m.TodayPage)
      },
      {
        path: 'topics',
        loadComponent: () => import('./pages/study-setup/study-setup.page').then(m => m.StudySetupPage)
      },
      {
        path: 'progress',
        loadComponent: () => import('./pages/stats/stats.page').then(m => m.StatsPage)
      },
      {
        path: 'settings',
        loadComponent: () => import('./pages/settings/settings.page').then(m => m.SettingsPage)
      },
      {
        path: '',
        redirectTo: 'today',
        pathMatch: 'full'
      },
    ]
  },
  // Direcciones de antes de las pestañas (enlaces guardados, historial).
  {
    path: 'study-setup',
    redirectTo: 'tabs/topics'
  },
  {
    path: 'stats',
    redirectTo: 'tabs/progress'
  },
  {
    path: 'flashcards',
    loadComponent: () => import('./pages/flashcards/flashcards.page').then( m => m.FlashcardsPage)
  },
  // Las palabras de un tema guardado, por su clave (toTopicKey).
  {
    path: 'topic-words/:topic',
    loadComponent: () => import('./pages/topic-words/topic-words.page').then(m => m.TopicWordsPage)
  },
];
