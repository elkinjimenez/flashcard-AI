import { Injectable } from '@angular/core';

// Pronunciación de palabras en inglés con la voz del sistema. Sin síntesis de voz, no suena nada.
@Injectable({ providedIn: 'root' })
export class PronunciationService {
  // interrupt: corta lo que esté sonando (el botón de escuchar); si no, se encola detrás (p. ej. tras la locución muda).
  speak(word: string, interrupt = true) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    // cancel() justo antes de speak() puede recortar el comienzo: solo si de verdad hay algo sonando.
    if (interrupt && (synthesizer.speaking || synthesizer.pending)) {
      synthesizer.cancel();
    }
    synthesizer.resume();
    synthesizer.speak(this.createUtterance(synthesizer, word));
  }

  // En el móvil el audio se "duerme" tras un rato en silencio y se come el comienzo de la palabra. Una locución muda lo
  // despierta; la voz real se pide después, sin interrumpirla.
  warmUp(word: string) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    if (synthesizer.speaking || synthesizer.pending) {
      synthesizer.cancel();
    }
    const utterance = this.createUtterance(synthesizer, word);
    utterance.volume = 0;
    // Más rápida para que termine antes de que empiece la voz real.
    utterance.rate = 2;
    synthesizer.speak(utterance);
  }

  private createUtterance(synthesizer: SpeechSynthesis, word: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(word.trim());
    utterance.rate = 0.85;
    utterance.lang = 'en-US';
    const englishVoice = synthesizer.getVoices()
      .find(voice => voice.lang.toLowerCase().startsWith('en'));
    if (englishVoice) {
      utterance.voice = englishVoice;
    }
    return utterance;
  }
}
