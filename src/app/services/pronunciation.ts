import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { loadSetting, saveSetting } from './local-setting';

// Normal va algo más lenta que el habla real: es para aprender.
export const speechRates = [
  { id: 0.65, label: 'Lenta' },
  { id: 0.85, label: 'Normal' },
  { id: 1, label: 'Rápida' },
] as const;

export type SpeechRate = typeof speechRates[number]['id'];

const voiceSetting = 'voice';
const rateSetting = 'speech-rate';
const defaultRate: SpeechRate = 0.85;

// Voces de Apple que suenan raro: las de broma (algunas cantan) y las sintéticas antiguas. No sirven para aprender: ni
// se ofrecen ni se eligen solas. En iOS el nombre viene traducido («Órgano», «Buenas noticias», «Abuela»): se reconocen
// por el final de su voiceURI, que no se traduce, o por el nombre en inglés donde el voiceURI es el propio nombre.
const oddVoices = new Set([
  'albert', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'goodnews', 'badnews', 'hysterical', 'jester',
  'organ', 'pipeorgan', 'princess', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
  'fred', 'junior', 'kathy', 'ralph',
  'eddy', 'flo', 'grandma', 'grandpa', 'reed', 'rocko', 'sandy', 'shelley'
]);

export function toSpeechRate(value: unknown): SpeechRate | undefined {
  return speechRates.find(option => option.id === Number(value))?.id;
}

// Android puede dar el idioma como en_US.
export function voiceLanguage(voice: SpeechSynthesisVoice): string {
  return voice.lang.replace('_', '-');
}

// "com.apple.speech.synthesis.voice.GoodNews" o "Good News (English (US))" -> "goodnews". Las sintéticas antiguas
// (Eloquence) llevan la marca en el voiceURI: com.apple.eloquence.en-US.Eddy.
function isOddVoice(voice: SpeechSynthesisVoice): boolean {
  const key = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');
  return /eloquence/i.test(voice.voiceURI)
    || oddVoices.has(key(voice.voiceURI.split('.').pop() ?? ''))
    || oddVoices.has(key(voice.name.split(' (')[0]));
}

// Pronunciación de palabras (y textos) en inglés con la voz del sistema. Sin síntesis de voz, no suena nada.
@Injectable({ providedIn: 'root' })
export class PronunciationService {
  // En algunos navegadores (Chrome) las voces llegan después de abrir la app.
  readonly voicesChanged = new Subject<void>();
  // voiceURI de la voz elegida en Ajustes; null: la automática (ver bestVoice).
  voiceId: string | null = loadSetting(voiceSetting);
  rate: SpeechRate = toSpeechRate(loadSetting(rateSetting)) ?? defaultRate;

  constructor() {
    window.speechSynthesis?.addEventListener?.('voiceschanged', () => this.voicesChanged.next());
  }

  get available(): boolean {
    return 'speechSynthesis' in window;
  }

  // Para elegir en Ajustes: las de EE. UU. primero (la lengua de la app), luego por idioma y nombre.
  englishVoices(): SpeechSynthesisVoice[] {
    const usFirst = (voice: SpeechSynthesisVoice) => voiceLanguage(voice).toLowerCase() === 'en-us' ? 0 : 1;
    return this.usableVoices().sort((a, b) => usFirst(a) - usFirst(b)
      || voiceLanguage(a).localeCompare(voiceLanguage(b))
      || a.name.localeCompare(b.name));
  }

  // La elegida si el dispositivo aún la tiene; si no, la que mejor suena.
  currentVoice(): SpeechSynthesisVoice | undefined {
    return this.usableVoices().find(voice => voice.voiceURI === this.voiceId) ?? this.bestVoice();
  }

  // Las neuronales, las de Siri y las de calidad mejorada de Apple suenan mucho más naturales; si no hay, la de EE. UU. o
  // la británica. Con empate, la primera del sistema (su orden suele poner delante la principal, como Samantha en iOS).
  bestVoice(): SpeechSynthesisVoice | undefined {
    const score = (voice: SpeechSynthesisVoice) => {
      const description = `${voice.name} ${voice.voiceURI}`;
      const language = voiceLanguage(voice).toLowerCase();
      let points = language === 'en-us' ? 2 : language === 'en-gb' ? 1 : 0;
      if (/natural|neural|premium|enhanced|siri/i.test(description)) points += 4;
      if (/google|samantha/i.test(description)) points += 1;
      return points;
    };
    return this.usableVoices().reduce<SpeechSynthesisVoice | undefined>(
      (best, voice) => !best || score(voice) > score(best) ? voice : best, undefined);
  }

  // En inglés y sin las que suenan raro, en el orden del sistema.
  private usableVoices(): SpeechSynthesisVoice[] {
    return (window.speechSynthesis?.getVoices() ?? [])
      .filter(voice => voiceLanguage(voice).toLowerCase().startsWith('en') && !isOddVoice(voice));
  }

  setVoice(voiceId: string | null) {
    this.voiceId = voiceId;
    saveSetting(voiceSetting, voiceId);
  }

  setRate(rate: SpeechRate) {
    this.rate = rate;
    saveSetting(rateSetting, String(rate));
  }

  // interrupt: corta lo que esté sonando (el botón de escuchar); si no, se encola detrás (p. ej. tras la locución muda).
  speak(word: string, interrupt = true) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    // cancel() justo antes de speak() puede recortar el comienzo: solo si de verdad hay algo sonando.
    if (interrupt && (synthesizer.speaking || synthesizer.pending)) {
      synthesizer.cancel();
    }
    synthesizer.resume();
    synthesizer.speak(this.createUtterance(word));
  }

  // Un texto largo, frase a frase: en Chrome una locución larga se corta a los pocos segundos. Se resuelve al terminar de
  // leerlo o al detenerlo (con stop o con otra locución).
  speakText(text: string): Promise<void> {
    const synthesizer = window.speechSynthesis;
    const sentences = (text.match(/[^.!?\n]+[.!?]*/g) ?? []).map(sentence => sentence.trim()).filter(Boolean);
    if (!synthesizer || !sentences.length) return Promise.resolve();

    this.stop();
    synthesizer.resume();
    const utterances = sentences.map(sentence => this.createUtterance(sentence));
    const finished = new Promise<void>(resolve => {
      const last = utterances[utterances.length - 1];
      last.onend = () => resolve();
      last.onerror = () => resolve();
    });
    utterances.forEach(utterance => synthesizer.speak(utterance));
    return finished;
  }

  stop() {
    const synthesizer = window.speechSynthesis;
    if (synthesizer && (synthesizer.speaking || synthesizer.pending)) {
      synthesizer.cancel();
    }
  }

  // En el móvil el audio se "duerme" tras un rato en silencio y se come el comienzo de la palabra. Una locución muda lo
  // despierta; la voz real se pide después, sin interrumpirla.
  warmUp(word: string) {
    const synthesizer = window.speechSynthesis;
    if (!synthesizer || !word.trim()) return;

    if (synthesizer.speaking || synthesizer.pending) {
      synthesizer.cancel();
    }
    const utterance = this.createUtterance(word);
    utterance.volume = 0;
    // Más rápida para que termine antes de que empiece la voz real.
    utterance.rate = 2;
    synthesizer.speak(utterance);
  }

  private createUtterance(word: string): SpeechSynthesisUtterance {
    const utterance = new SpeechSynthesisUtterance(word.trim());
    utterance.rate = this.rate;
    utterance.lang = 'en-US';
    const voice = this.currentVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voiceLanguage(voice);
    }
    return utterance;
  }
}
