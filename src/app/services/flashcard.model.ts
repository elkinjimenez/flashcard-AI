export interface Flashcard {
  word: string;
  translation: string;
  imageUrl: string;
  // Frase corta en inglés que usa la palabra. undefined: aún no se pidió (temas guardados antes de existir);
  // '': Gemini no dio ninguna y no se vuelve a pedir.
  example?: string;
  // Palabras en inglés que se confunden con esta (knife / fork, shelf / shell): las opciones falsas preferidas en los
  // ejercicios. undefined: aún no se pidieron (palabras guardadas antes de existir); []: Gemini no dio ninguna.
  confusables?: string[];
  // Búsqueda visual para Klipy propuesta por Gemini ("dog wagging tail"); las palabras antiguas no la tienen.
  imageQuery?: string;
  // Fecha (ISO) de la última búsqueda de imagen que no encontró nada: no se repite hasta pasado un día.
  imageSearchedAt?: string;
  // Desde la caja 6 (learnedBox). Sigue saliendo en sus repasos de mantenimiento.
  learned?: boolean;
  // Caja de Leitner: 0 = nueva o fallada, 1..5 = aprendiendo, 6..8 = aprendida (repasos de mantenimiento).
  box?: number;
  // Veces que se ha fallado, para las estadísticas (se cuenta desde que existe el campo).
  misses?: number;
  // Truco para recordarla (método de la palabra clave) que crea la IA cuando cuesta (ver mnemonicMisses).
  // undefined: aún no se pidió; '': la IA no dio ninguno y no se vuelve a pedir.
  mnemonic?: string;
  // Fecha (ISO) desde la que la tarjeta vuelve a tocar.
  nextReview?: string;
}

// Días hasta el próximo repaso al subir a cada caja (1..8); desde la última se repite su intervalo. Las cajas 6 en
// adelante son de mantenimiento: la palabra ya está aprendida, pero vuelve de vez en cuando para que no se olvide sin notarlo.
export const reviewIntervalDays = [1, 3, 7, 14, 30, 60, 120, 240];
// Acertar el repaso de la caja 5 (a los 30 días) la sube aquí y la marca como aprendida.
export const learnedBox = 6;

// Fallos desde los que una palabra "cuesta": al fallarla se enseña su truco para recordarla, creado por la IA.
export const mnemonicMisses = 2;

// Nunca respondida (o de un tema reiniciado).
export function isNewCard(card: Flashcard): boolean {
  return !card.learned && card.box === undefined && !card.nextReview;
}
