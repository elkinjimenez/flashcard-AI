import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

// code es el del navegador ('not-allowed', 'no-speech', 'network', 'audio-capture', 'aborted'...) o 'not-supported'.
export class SpeechRecognitionError extends Error {
  constructor(readonly code: string) {
    super(`Reconocimiento de voz: ${code}`);
  }
}

// Lo mínimo de la Web Speech API que se usa: TypeScript no trae sus tipos.
interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

// Reconocimiento de voz para la práctica de habla.
// Hoy usa el del navegador: Chrome y Samsung Internet en Android, Safari en iOS (Firefox y Chrome en iPhone no lo tienen).
// El WebView de la app nativa tampoco lo trae: para Android e iOS hay que añadir aquí el plugin
// @capgo/capacitor-speech-recognition, y el resto de la app no cambia.
@Injectable({ providedIn: 'root' })
export class SpeechRecognitionService {
  // Safari a veces no para solo: pasado este tiempo se corta.
  private readonly maxListenMs = 7000;
  private active?: BrowserSpeechRecognition;

  get isSupported(): boolean {
    return !Capacitor.isNativePlatform() && !!this.browserRecognition;
  }

  // Escucha una palabra o frase corta y devuelve las transcripciones posibles, de más a menos probable.
  // Hay que llamarlo desde un toque del usuario: Safari no deja abrir el micrófono de otra forma.
  listen(lang = 'en-US'): Promise<string[]> {
    const Recognition = this.browserRecognition;
    if (!this.isSupported || !Recognition) {
      return Promise.reject(new SpeechRecognitionError('not-supported'));
    }

    this.stop();
    return new Promise((resolve, reject) => {
      const recognition = new Recognition();
      recognition.lang = lang;
      // En Safari el modo continuo no llega a entregar el texto.
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 5;

      let transcripts: string[] = [];
      let settled = false;
      const finish = (error?: SpeechRecognitionError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.active === recognition) this.active = undefined;
        if (error) {
          reject(error);
        } else {
          resolve(transcripts);
        }
      };
      // Si ni al pararlo avisa de que terminó, se da por acabado igualmente.
      const timer = setTimeout(() => {
        recognition.stop();
        setTimeout(() => finish(), 1000);
      }, this.maxListenMs);

      recognition.onresult = event => {
        transcripts = Array.from(event.results[0] ?? [], alternative => alternative.transcript.trim());
      };
      recognition.onerror = event => finish(new SpeechRecognitionError(event.error));
      recognition.onend = () => finish();

      this.active = recognition;
      try {
        recognition.start();
      } catch {
        finish(new SpeechRecognitionError('start-failed'));
      }
    });
  }

  stop() {
    this.active?.abort();
    this.active = undefined;
  }

  private get browserRecognition(): BrowserSpeechRecognitionConstructor | undefined {
    const browser = window as unknown as {
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
  }
}
