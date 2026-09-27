import { addIcons } from 'ionicons';
import {
  airplaneOutline, barbellOutline, bookOutline, briefcaseOutline, carOutline, cartOutline, cashOutline, cloudOutline,
  colorPaletteOutline, flaskOutline, homeOutline, languageOutline, laptopOutline, leafOutline, medkitOutline,
  musicalNotesOutline, pawOutline, peopleOutline, restaurantOutline, schoolOutline, shirtOutline
} from 'ionicons/icons';

// Icono de cada tema según su nombre (lo inventa la IA, así que se reconoce por palabras sueltas).
const iconMap: ReadonlyArray<readonly [RegExp, string]> = [
  [/(comida|cocin|receta|gastronom|food|cook|meal|restaurant)/i, 'restaurant-outline'],
  [/(viaje|viajar|ciudad|país|pais|destino|cultura|travel|trip|country)/i, 'airplane-outline'],
  [/(animal|mascota|naturaleza|planta|pet|nature)/i, 'paw-outline'],
  [/(negocio|empresa|trabajo|oficina|profesi[oó]n|business|work|office)/i, 'briefcase-outline'],
  [/(cuerpo|salud|m[eé]dico|doctor|enfermedad|body|health|medical)/i, 'medkit-outline'],
  [/(deporte|ejercicio|gimnasio|f[uú]tbol|sport|exercise|gym)/i, 'barbell-outline'],
  [/(m[uú]sica|canci[oó]n|instrumento|music|song)/i, 'musical-notes-outline'],
  [/(tecnolog|comput|c[oó]digo|programaci[oó]n|internet|tech|code)/i, 'laptop-outline'],
  [/(familia|hogar|casa|family|home|house)/i, 'home-outline'],
  [/(ropa|moda|fashion|clothes)/i, 'shirt-outline'],
  [/(clima|tiempo|lluvia|sol|weather|climate)/i, 'cloud-outline'],
  [/(dinero|finanz|precio|econom|money|finance|price)/i, 'cash-outline'],
  [/(arte|pintura|dibujo|dise[ñn]o|art|paint|draw)/i, 'color-palette-outline'],
  [/(ciencia|qu[ií]mica|biolog|f[ií]sica|science|space)/i, 'flask-outline'],
  [/(idioma|lenguaje|gram[aá]tica|vocabulario|language|grammar)/i, 'language-outline'],
  [/(compra|tienda|mercado|shopping|shop|store)/i, 'cart-outline'],
  [/(escuela|educaci[oó]n|estudio|aprend|school|education|study)/i, 'school-outline'],
  [/(ecolog|ambient|sosten|ecology|environment)/i, 'leaf-outline'],
  [/(coche|auto|carro|transporte|veh[ií]culo|car|transport)/i, 'car-outline'],
  [/(gente|persona|amigo|social|people|friend)/i, 'people-outline']
];

// Registra todos los iconos de tema: cada página que los muestra la llama en su constructor.
export function registerTopicIcons() {
  addIcons({
    airplaneOutline, barbellOutline, bookOutline, briefcaseOutline, carOutline, cartOutline, cashOutline, cloudOutline,
    colorPaletteOutline, flaskOutline, homeOutline, languageOutline, laptopOutline, leafOutline, medkitOutline,
    musicalNotesOutline, pawOutline, peopleOutline, restaurantOutline, schoolOutline, shirtOutline
  });
}

export function topicIcon(label: string): string {
  return iconMap.find(([pattern]) => pattern.test(label))?.[1] ?? 'book-outline';
}
