import { Directive, ElementRef, HostListener, inject } from '@angular/core';
import { FlashcardService } from './services/flashcard';
import { klipyPlaceholderSize } from './services/card-images';

// En las imágenes de las tarjetas: si no cargan o llega algo del tamaño de la imagen de relleno de Klipy (la que sirve
// cuando se borra un GIF), se comprueba si ya no existe para quitarla y buscar otra (ver dropMissingImage).
@Directive({
  selector: 'img[appCardImage]',
  standalone: true,
})
export class CardImageDirective {
  private flashcardService = inject(FlashcardService);
  private image: HTMLImageElement = inject(ElementRef).nativeElement;

  @HostListener('load')
  onLoad() {
    const { naturalWidth, naturalHeight } = this.image;
    if (naturalWidth === klipyPlaceholderSize.width && naturalHeight === klipyPlaceholderSize.height) {
      this.flashcardService.dropMissingImage(this.image.src);
    }
  }

  @HostListener('error')
  onError() {
    this.flashcardService.dropMissingImage(this.image.src);
  }
}
