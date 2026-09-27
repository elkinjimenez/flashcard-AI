// Reconocer la palabra de una tarjeta aunque aparezca conjugada o en plural.

// La palabra y sus derivadas ("run" → "running"), para tapar o resaltar en la frase de ejemplo.
export function wordPattern(word: string): RegExp {
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(\\b${escaped}\\w*)`, 'gi');
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
  // Consonante doblada tras vocal corta: run → running, stop → stopped.
  if (/[^aeiou][aeiou][bdgklmnprt]$/.test(word)) {
    const doubled = word + word.slice(-1);
    forms.add(doubled + 'ing').add(doubled + 'ed');
  }
  return forms;
}
