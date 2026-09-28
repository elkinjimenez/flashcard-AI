const prefix = 'flashcards-ai.';

// Un ajuste guardado en el navegador. Si el almacenamiento falla (navegación privada, datos bloqueados) se lee null y
// cada cual usa su valor por defecto.
export function loadSetting(name: string): string | null {
  try {
    return localStorage.getItem(prefix + name);
  } catch {
    return null;
  }
}

// Borra todo lo guardado con el prefijo (también la bienvenida y la palabra del día): todo vuelve a su valor por defecto.
export function clearSettings() {
  try {
    Object.keys(localStorage).filter(key => key.startsWith(prefix)).forEach(key => localStorage.removeItem(key));
  } catch {
    // Sin almacenamiento no hay nada guardado.
  }
}

// null lo borra: vuelve al valor por defecto.
export function saveSetting(name: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(prefix + name);
    } else {
      localStorage.setItem(prefix + name, value);
    }
  } catch {
    // Sin almacenamiento, el ajuste solo dura hasta que se cierre la app.
  }
}
