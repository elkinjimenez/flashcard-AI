import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { loadSetting, saveSetting } from './local-setting';

const soundsSetting = 'answer-sounds';
const vibrationSetting = 'answer-vibration';

// Una nota del sonido: de `from` a `to` Hz (si baja o sube), desde `start` y durante `duration` segundos.
interface Note {
  from: number;
  to?: number;
  start: number;
  duration: number;
}

// Acertar: dos notas cortas que suben. Fallar: una grave que baja un poco; avisa sin sonar a castigo.
const correctSound = { wave: 'sine' as OscillatorType, volume: 0.12, notes: [
  { from: 587, start: 0, duration: 0.09 },
  { from: 880, start: 0.08, duration: 0.14 }
] };
const wrongSound = { wave: 'triangle' as OscillatorType, volume: 0.1, notes: [
  { from: 262, to: 196, start: 0, duration: 0.2 }
] };

// Si el audio tarda más en arrancar (esperaba un toque), el sonido ya no corresponde a la respuesta: no suena.
const maxSoundDelayMs = 300;
// Sin sonar, el audio se suspende pasado este tiempo: abierto gasta batería. Vuelve con el siguiente toque.
const idleSuspendMs = 15_000;

// Lo que se nota al responder: un sonido suave y una vibración corta, distintos al acertar y al fallar. Cada uno se
// apaga en Ajustes. La vibración solo donde la haya: en la app nativa y en los navegadores con vibrate (no en Safari).
@Injectable({ providedIn: 'root' })
export class AnswerFeedbackService {
  readonly canVibrate = Capacitor.isNativePlatform() || 'vibrate' in navigator;
  sounds = loadSetting(soundsSetting) !== 'off';
  vibration = loadSetting(vibrationSetting) !== 'off';
  private context?: AudioContext;
  private suspendTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // El navegador solo deja arrancar el audio al tocar o pulsar una tecla. Así también suena la respuesta que llega
    // después, como la del ejercicio de hablar. En iOS se suspende al salir de la app: con el siguiente toque vuelve.
    const unlock = () => {
      const context = this.sounds ? this.audioContext() : undefined;
      if (!context) return;
      context.resume().catch(() => undefined);
      this.suspendWhenIdle(context);
    };
    document.addEventListener('pointerup', unlock, { capture: true, passive: true });
    document.addEventListener('keydown', unlock, { capture: true, passive: true });
  }

  answered(knew: boolean) {
    this.vibrate(() => knew
      ? Haptics.impact({ style: ImpactStyle.Light })
      : Haptics.notification({ type: NotificationType.Error }));
    this.play(knew ? correctSound : wrongSound);
  }

  // Con la celebración del resumen.
  sessionFinished() {
    this.vibrate(() => Haptics.notification({ type: NotificationType.Success }));
  }

  // Al encenderlos se nota cómo son.
  setSounds(on: boolean) {
    this.sounds = on;
    saveSetting(soundsSetting, on ? null : 'off');
    this.play(correctSound);
  }

  setVibration(on: boolean) {
    this.vibration = on;
    saveSetting(vibrationSetting, on ? null : 'off');
    this.vibrate(() => Haptics.impact({ style: ImpactStyle.Light }));
  }

  private vibrate(run: () => Promise<void>) {
    if (!this.vibration || !this.canVibrate) return;
    // En el navegador lanza al instante si no puede vibrar.
    try {
      run().catch(() => undefined);
    } catch {
      // Sin vibración.
    }
  }

  private play(sound: { wave: OscillatorType; volume: number; notes: Note[] }) {
    const context = this.sounds ? this.audioContext() : undefined;
    if (!context) return;

    this.suspendWhenIdle(context);
    if (context.state === 'running') {
      this.schedule(context, sound.wave, sound.volume, sound.notes);
      return;
    }
    const requested = Date.now();
    context.resume()
      .then(() => {
        if (Date.now() - requested <= maxSoundDelayMs) {
          this.schedule(context, sound.wave, sound.volume, sound.notes);
        }
      })
      .catch(() => undefined);
  }

  // Cada nota entra rápido y se apaga suave: sin chasquidos.
  private schedule(context: AudioContext, wave: OscillatorType, volume: number, notes: Note[]) {
    const at = context.currentTime + 0.01;
    for (const note of notes) {
      const start = at + note.start;
      const end = start + note.duration;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(note.from, start);
      if (note.to) oscillator.frequency.exponentialRampToValueAtTime(note.to, end);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  }

  private suspendWhenIdle(context: AudioContext) {
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => context.suspend().catch(() => undefined), idleSuspendMs);
  }

  // Se crea al primer uso; sin Web Audio no suena nada.
  private audioContext(): AudioContext | undefined {
    if (!this.context && typeof AudioContext !== 'undefined') {
      try {
        this.context = new AudioContext();
      } catch (error) {
        console.warn('No se pudo preparar el sonido', error);
      }
    }
    return this.context;
  }
}
