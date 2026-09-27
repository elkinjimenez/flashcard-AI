// Día local (AAAA-MM-DD) de una fecha: la actividad se agrupa por el día del usuario, no por el de UTC.
export function toDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
