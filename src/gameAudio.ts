/**
 * Pixel Breaker - Procedural Web Audio & Haptics Engine
 * Synthesizes retro arcade sounds with oscillator nodes and envelopes.
 * No external audio files or assets.
 */

import { CONFIG } from './gameConfig';

class GameAudioEngine {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = true;
  private hapticsEnabled: boolean = true;
  private isUnlocked: boolean = false;
  private lastWallHitSound: number = 0;
  private lastBrickHitSound: number = 0;
  private lastHapticTime: number = 0;

  constructor() {
    // Read persisted sound preference safely
    try {
      const saved = localStorage.getItem('pixel_breaker_sound_enabled');
      if (saved !== null) {
        this.soundEnabled = JSON.parse(saved);
      }
    } catch {
      this.soundEnabled = true;
    }
  }

  /**
   * Resumes and unlocks the AudioContext on the first user interaction
   */
  public initAudio(): void {
    if (!this.ctx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        this.isUnlocked = true;
      }).catch(() => {});
    } else if (this.ctx) {
      this.isUnlocked = true;
    }
  }

  public setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    try {
      localStorage.setItem('pixel_breaker_sound_enabled', JSON.stringify(enabled));
    } catch {}
  }

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public toggleSound(): boolean {
    this.setSoundEnabled(!this.soundEnabled);
    return this.soundEnabled;
  }

  /**
   * Short haptic feedback on supported mobile devices
   */
  public triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'double'): void {
    if (!this.hapticsEnabled || typeof navigator === 'undefined' || !navigator.vibrate) {
      return;
    }
    const nowMs = performance.now();
    if (nowMs - this.lastHapticTime < 50) return;
    this.lastHapticTime = nowMs;

    try {
      if (type === 'light') {
        navigator.vibrate(8);
      } else if (type === 'medium') {
        navigator.vibrate(18);
      } else if (type === 'heavy') {
        navigator.vibrate([25, 40, 25]);
      } else if (type === 'double') {
        navigator.vibrate([15, 30, 20]);
      }
    } catch {
      // Ignore vibration error on restricted browser frames
    }
  }

  /**
   * Ball bounces off paddle
   */
  public playPaddleHit(): void {
    this.triggerHaptic('light');
    if (!this.soundEnabled || !this.ctx) return;
    this.initAudio();

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.06);

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }

  /**
   * Ball bounces off indestructible gray wall
   */
  public playWallHit(): void {
    if (!this.soundEnabled || !this.ctx) return;
    const nowMs = performance.now();
    if (nowMs - this.lastWallHitSound < 35) return;
    this.lastWallHitSound = nowMs;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(120, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.04);

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.05);
    } catch {}
  }

  /**
   * Normal brick destroyed. Rising pitch with combo multiplier!
   */
  public playBrickHit(combo: number = 1): void {
    this.triggerHaptic('light');
    if (!this.soundEnabled || !this.ctx) return;
    const nowMs = performance.now();
    if (nowMs - this.lastBrickHitSound < 22) return;
    this.lastBrickHitSound = nowMs;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      // Pitch increases smoothly with combo
      const baseFreq = 260 + Math.min(combo * 28, 900);
      osc.type = 'square';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.35, now + 0.05);

      const vol = Math.min(CONFIG.AUDIO.MASTER_VOLUME * (0.28 + Math.min(combo, 10) * 0.02), 0.55);
      gain.gain.setValueAtTime(vol, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.07);
    } catch {}
  }

  /**
   * Special yellow brick destroyed: bright metallic chime!
   */
  public playYellowBrickHit(): void {
    this.triggerHaptic('medium');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      
      // Dual oscillators for shimmering chime
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now); // A5
      osc1.frequency.exponentialRampToValueAtTime(1760, now + 0.12); // A6

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1320, now); // E6
      osc2.frequency.exponentialRampToValueAtTime(2640, now + 0.12); // E7

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(this.ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.18);
      osc2.stop(now + 0.18);
    } catch {}
  }

  /**
   * Positive Power-up collected: cheerful ascending arpeggio
   */
  public playPowerUpCollect(): void {
    this.triggerHaptic('medium');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const notes = [440, 554, 659, 880]; // A4, C#5, E5, A5

      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const noteTime = now + idx * 0.04;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.35, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.08);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(noteTime);
        osc.stop(noteTime + 0.08);
      });
    } catch {}
  }

  /**
   * Bad Power-up collected: descending buzzer
   */
  public playBadPowerUpCollect(): void {
    this.triggerHaptic('double');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.linearRampToValueAtTime(90, now + 0.25);

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.45, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.28);
    } catch {}
  }

  /**
   * Secret bonus hidden in brick found!
   */
  public playSecretBonus(): void {
    this.triggerHaptic('heavy');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        if (!this.ctx) return;
        const time = now + idx * 0.06;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(time);
        osc.stop(time + 0.15);
      });
    } catch {}
  }

  /**
   * Laser vertical beam fired
   */
  public playLaser(): void {
    this.triggerHaptic('heavy');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.32);

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.32);
    } catch {}
  }

  /**
   * Ball falls below paddle
   */
  public playBallLoss(): void {
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.18);

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    } catch {}
  }

  /**
   * All balls lost, life deducted
   */
  public playLifeLost(): void {
    this.triggerHaptic('heavy');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.35);

      gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch {}
  }

  /**
   * Level Won fanfare
   */
  public playLevelWin(): void {
    this.triggerHaptic('double');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const notes = [
        { f: 523.25, t: 0.00, d: 0.10 }, // C5
        { f: 659.25, t: 0.12, d: 0.10 }, // E5
        { f: 783.99, t: 0.24, d: 0.10 }, // G5
        { f: 1046.5, t: 0.36, d: 0.28 }, // C6
      ];

      notes.forEach(({ f, t, d }) => {
        if (!this.ctx) return;
        const time = now + t;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, time);

        gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + d);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(time);
        osc.stop(time + d);
      });
    } catch {}
  }

  /**
   * Level Failed jingle
   */
  public playLevelFail(): void {
    this.triggerHaptic('heavy');
    if (!this.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const notes = [
        { f: 392.00, t: 0.00, d: 0.12 }, // G4
        { f: 349.23, t: 0.14, d: 0.12 }, // F4
        { f: 311.13, t: 0.28, d: 0.15 }, // Eb4
        { f: 261.63, t: 0.44, d: 0.40 }, // C4
      ];

      notes.forEach(({ f, t, d }) => {
        if (!this.ctx) return;
        const time = now + t;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, time);

        gain.gain.setValueAtTime(CONFIG.AUDIO.MASTER_VOLUME * 0.4, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + d);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(time);
        osc.stop(time + d);
      });
    } catch {}
  }
}

export const gameAudio = new GameAudioEngine();
