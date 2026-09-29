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
  // Desde la caja 6 (learnedBox). Sigue saliendo en sus repasos de mantenimiento. Fallarla la quita de aprendidas hasta
  // que acierte su próximo repaso, aunque siga en la caja 6 o más (ver boxAfterLapse).
  learned?: boolean;
  // Caja de Leitner: 0 = nueva, 1..5 = aprendiendo, 6..8 = aprendida (repasos de mantenimiento).
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

// Cajas que baja una palabra al fallarla: no vuelve a empezar de cero (una de la caja 8 no espera meses para contar
// otra vez como aprendida), pero sus repasos se acercan hasta que se afiance de nuevo.
export const lapseBoxes = 2;

export function boxAfterLapse(card: Flashcard): number {
  return Math.max((card.box ?? 0) - lapseBoxes, 0);
}

// Fallos desde los que una palabra "cuesta": al fallarla se enseña su truco para recordarla, creado por la IA.
export const mnemonicMisses = 2;

// Nunca respondida (o de un tema reiniciado).
export function isNewCard(card: Flashcard): boolean {
  return !card.learned && card.box === undefined && !card.nextReview;
}

// Desde esta caja la palabra está afianzada y cuenta como "ya la sabes": acertó el día que la empezó, al día siguiente y
// a los 3 días. Acertarla una vez no basta: en la misma sesión se recuerda sin esfuerzo.
export const knownFromBox = 3;

// Afianzada o aprendida. Una aprendida que se falla baja a la caja 4 o más: sigue contando.
export function isKnownCard(card: Flashcard): boolean {
  return !!card.learned || (card.box ?? 0) >= knownFromBox;
}

// Pasos dados hacia saberla (0..knownFromBox): uno por cada día que acertó y la subió de caja. Avanza en cada repaso,
// no solo al llegar a sabida; fallarla lo hace retroceder.
export function knownSteps(card: Flashcard): number {
  return isKnownCard(card) ? knownFromBox : Math.min(card.box ?? 0, knownFromBox);
}

// Avance de un grupo de palabras (0..100): los pasos dados de todos los necesarios para sabérselas. Con algún paso no se
// queda en 0, y no llega a 100 hasta sabérselas todas.
export function knownStepsPercent(cards: Flashcard[]): number {
  const steps = cards.reduce((sum, card) => sum + knownSteps(card), 0);
  if (!steps) return 0;
  return Math.max(1, Math.floor(steps * 100 / (cards.length * knownFromBox)));
}
