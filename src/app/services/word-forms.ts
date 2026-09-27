// Reconocer la palabra de una tarjeta aunque aparezca conjugada o en plural.

// La palabra y sus derivadas ("run" → "running"), para tapar o resaltar en la frase de ejemplo.
export function wordPattern(word: string): RegExp {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(\\b${escaped}\\w*)`, 'gi');
}

// Para comparar lo dicho o escrito con la palabra: sin mayúsculas, tildes, guiones ni signos.
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/’/g, '\'')
    .replace(/[^a-z0-9']+/g, ' ')
    .trim();
}

// Una letra de más, de menos, cambiada o dos seguidas al revés (recieve por receive). Solo desde 4 letras: en las
// cortas un cambio ya da otra palabra (cat / car).
export function isTypo(typed: string, word: string): boolean {
  if (typed === word || word.length < 4 || Math.abs(typed.length - word.length) > 1) return false;
  return editDistance(typed, word) === 1;
}

// Damerau-Levenshtein (alineamiento óptimo): cambiar dos letras seguidas cuenta como un solo error.
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Si una es la otra con una terminación regular (jump / jumps / jumped / jumping), en cualquier sentido.
// Las irregulares (run / ran) no se reconocen.
export function isSameWord(a: string, b: string): boolean {
  return a === b || inflections(a).has(b) || inflections(b).has(a);
}

// Plural o tercera persona, pasado y gerundio. Sin comparativos: -er daría por buenas palabras distintas (farm / farmer).
function inflections(word: string): Set<string> {
  const forms = new Set<string>();
  if (word.length < 2) return forms;

  forms.add(word + 's').add(word + 'ed').add(word + 'ing');
  // bus → buses, watch → watches, go → goes.
  if (/(s|x|z|ch|sh|o)$/.test(word)) forms.add(word + 'es');
  // cry → cries, cried.
  if (/[^aeiou]y$/.test(word)) forms.add(word.slice(0, -1) + 'ies').add(word.slice(0, -1) + 'ied');
  // dance → danced; ni en las de dos letras ni tras otra e, que darían otra palabra (be / bed, fee / feed).
  if (word.length > 2 && /[^e]e$/.test(word)) forms.add(word + 'd');
  // dance → dancing; tras vocal la e se queda (see → seeing, no "being" por bee).
  if (/[^aeiou]e$/.test(word)) forms.add(word.slice(0, -1) + 'ing');
  // lie → lying.
  if (word.endsWith('ie')) forms.add(word.slice(0, -2) + 'ying');
  // knife → knives; shelf → shelves, leaf → leaves, thief → thieves, loaf → loaves (no cafe → caves ni roof → rooves).
  if (word.endsWith('ife')) forms.add(word.slice(0, -2) + 'ves');
  if (/(l|ea|ie|oa)f$/.test(word)) forms.add(word.slice(0, -1) + 'ves');
  // Consonante doblada tras vocal corta: run → running, stop → stopped.
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(word)) {
    const doubled = word + word.slice(-1);
    forms.add(doubled + 'ing').add(doubled + 'ed');
  }
  return forms;
}
