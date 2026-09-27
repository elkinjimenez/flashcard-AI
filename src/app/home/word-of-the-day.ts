export interface DailyWord {
  word: string;
  translation: string;
}

export const dailyWords: DailyWord[] = [
  { word: 'curious', translation: 'curioso · curiosa' },
  { word: 'brave', translation: 'valiente' },
  { word: 'journey', translation: 'viaje · trayecto' },
  { word: 'grateful', translation: 'agradecido · agradecida' },
  { word: 'whisper', translation: 'susurrar · susurro' },
  { word: 'bright', translation: 'brillante · luminoso' },
  { word: 'wonder', translation: 'preguntarse · maravilla' },
  { word: 'breeze', translation: 'brisa' },
  { word: 'thrive', translation: 'prosperar' },
  { word: 'cozy', translation: 'acogedor · acogedora' },
  { word: 'eager', translation: 'deseoso · deseosa' },
  { word: 'harvest', translation: 'cosecha' },
  { word: 'gentle', translation: 'amable · suave' },
  { word: 'puzzle', translation: 'rompecabezas · acertijo' },
  { word: 'borrow', translation: 'pedir prestado' },
  { word: 'shelter', translation: 'refugio' },
  { word: 'clumsy', translation: 'torpe' },
  { word: 'sunrise', translation: 'amanecer' },
  { word: 'achieve', translation: 'lograr · conseguir' },
  { word: 'neighbor', translation: 'vecino · vecina' },
  { word: 'reliable', translation: 'confiable · fiable' },
  { word: 'wander', translation: 'deambular · pasear' },
  { word: 'bold', translation: 'audaz · atrevido' },
  { word: 'meadow', translation: 'prado' },
  { word: 'yawn', translation: 'bostezar · bostezo' },
  { word: 'thoughtful', translation: 'considerado · atento' },
  { word: 'glimpse', translation: 'vistazo' },
  { word: 'sparkle', translation: 'brillar · destello' },
  { word: 'humble', translation: 'humilde' },
  { word: 'overcome', translation: 'superar' },
  { word: 'lighthouse', translation: 'faro' },
  { word: 'stubborn', translation: 'terco · terca' },
  { word: 'delightful', translation: 'encantador · encantadora' },
  { word: 'thunder', translation: 'trueno' },
  { word: 'improve', translation: 'mejorar' },
  { word: 'challenge', translation: 'desafío · reto' },
  { word: 'fearless', translation: 'intrépido · intrépida' },
  { word: 'blossom', translation: 'florecer · flor' },
  { word: 'kindness', translation: 'amabilidad · bondad' },
  { word: 'nearby', translation: 'cercano · cerca' },
];

// La misma palabra durante todo el día (hora local) y otra, al azar, al día siguiente.
export function pickWordOfTheDay(date = new Date()): DailyWord {
  const localDay = Math.floor((date.getTime() - date.getTimezoneOffset() * 60_000) / 86_400_000);

  // Mezcla el número de día para que días seguidos no den palabras seguidas de la lista.
  let hash = localDay;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = (hash ^ (hash >>> 16)) >>> 0;

  return dailyWords[hash % dailyWords.length];
}
