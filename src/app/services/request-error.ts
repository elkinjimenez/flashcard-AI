import { HttpErrorResponse } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

// Qué puede hacer el usuario cuando falla una consulta a la IA: sin conexión o sin cuota, reintentar enseguida no sirve.
export function describeRequestError(error: unknown): string {
  if (!navigator.onLine || (error instanceof HttpErrorResponse && error.status === 0)) {
    return 'Revisa tu conexión a internet e intenta nuevamente.';
  }
  if (error instanceof TimeoutError) {
    return 'La IA tardó demasiado en responder. Intenta nuevamente.';
  }
  if (error instanceof HttpErrorResponse && error.status === 429) {
    return 'Se alcanzó el límite de consultas a la IA. Intenta más tarde.';
  }
  if (error instanceof HttpErrorResponse && error.status >= 500) {
    return 'La IA no está disponible en este momento. Intenta en unos minutos.';
  }
  return 'Intenta nuevamente.';
}
