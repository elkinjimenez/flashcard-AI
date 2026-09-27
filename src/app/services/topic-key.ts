// Clave única de un tema: "Música", " musica " y "MÚSICA" son el mismo tema. Conserva la ñ ("año" ≠ "ano").
export function toTopicKey(topic: string): string {
  return topic
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/([aeiou])[̀-ͯ]+/g, '$1')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
}
