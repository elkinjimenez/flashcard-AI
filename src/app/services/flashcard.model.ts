export interface Flashcard {
  word: string;
  translation: string;
  imageUrl: string;
  // Frase corta en inglés que usa la palabra. undefined: aún no se pidió (temas guardados antes de existir);
  // '': Gemini no dio ninguna y no se vuelve a pedir.
  example?: string;
  // Búsqueda visual para Klipy propuesta por Gemini ("dog wagging tail"); las palabras antiguas no la tienen.
  imageQuery?: string;
  // Fecha (ISO) de la última búsqueda de imagen que no encontró nada: no se repite hasta pasado un día.
  imageSearchedAt?: string;
  learned?: boolean;
  // Caja de Leitner: 0 = nueva o fallada, 1..5 = repaso.
  box?: number;
  // Veces que se ha fallado, para las estadísticas (se cuenta desde que existe el campo).
  misses?: number;
  // Fecha (ISO) desde la que la tarjeta vuelve a tocar.
  nextReview?: string;
}
