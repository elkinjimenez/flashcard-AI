// 'cancelled': el usuario cerró el menú de compartir. 'failed': no se pudo ni compartir ni copiar.
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

// En el teléfono abre el menú de compartir; en el computador copia el texto. iOS solo deja compartir o copiar durante
// el toque: hay que llamarla desde el handler sin ningún await antes.
export async function shareText(text: string): Promise<ShareResult> {
  if (matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      console.error('No se pudo compartir', error);
      return 'failed';
    }
  }
  return await copyText(text) ? 'copied' : 'failed';
}

// Como shareText, solo durante el toque.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('No se pudo copiar', error);
    return false;
  }
}

export function sendToWhatsApp(text: string) {
  location.href = `whatsapp://send?text=${encodeURIComponent(text)}`;
}
