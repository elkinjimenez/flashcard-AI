import { Injectable } from '@angular/core';
import { loadSetting, saveSetting } from './local-setting';

export const themeModes = [
  { id: 'light', label: 'Claro', icon: 'sunny-outline' },
  { id: 'dark', label: 'Oscuro', icon: 'moon-outline' },
  { id: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
] as const;

export type ThemeMode = typeof themeModes[number]['id'];

// El mismo nombre, la misma clase y los mismos colores que usa el script de index.html.
const settingName = 'theme';
const darkClass = 'theme-dark';
const defaultMode: ThemeMode = 'light';
// El fondo de la app (--app-bg), para la barra de estado.
const lightBackground = '#f5f7fb';
const darkBackground = '#0e1220';

export function toThemeMode(value: unknown): ThemeMode | undefined {
  return themeModes.find(option => option.id === value)?.id;
}

// Claro u oscuro (los colores del oscuro, en theme/variables.scss). Con «Sistema», el del dispositivo, también si cambia
// con la app abierta. index.html ya pone el oscuro antes de que cargue la app: así no se ve un destello claro.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private systemDark = window.matchMedia('(prefers-color-scheme: dark)');

  mode: ThemeMode = toThemeMode(loadSetting(settingName)) ?? defaultMode;

  init() {
    this.systemDark.addEventListener('change', () => this.apply());
    this.apply();
  }

  setMode(mode: ThemeMode) {
    this.mode = mode;
    saveSetting(settingName, mode);
    this.apply();
  }

  private apply() {
    const dark = this.mode === 'dark' || (this.mode === 'system' && this.systemDark.matches);
    document.documentElement.classList.toggle(darkClass, dark);
    // Controles nativos y barras de desplazamiento a juego.
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
    // La barra de estado: en Android cambia al momento; iOS la lee al abrir la app, así que allí cambia la próxima vez.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? darkBackground : lightBackground);
    document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
      ?.setAttribute('content', dark ? 'black' : 'default');
  }
}
