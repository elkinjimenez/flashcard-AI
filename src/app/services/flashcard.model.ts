export interface Flashcard {
  word: string;
  translation: string;
  imageUrl: string;
  learned?: boolean;
  // Caja de Leitner: 0 = nueva o fallada, 1..5 = repaso.
  box?: number;
  // Fecha (ISO) desde la que la tarjeta vuelve a tocar.
  nextReview?: string;
}
