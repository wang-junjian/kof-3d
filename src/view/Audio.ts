/** WebAudio 程序化合成打击音，零音频资产、可离线。首次交互后解锁。 */
export class Sfx {
  private ctx: AudioContext | null = null;

  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private noise(duration: number, freq: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    filter.Q.value = 0.85;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  private tone(freq: number, duration: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.55), ctx.currentTime + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  hit(heavy: boolean, blocked: boolean): void {
    if (!this.ctx) return;
    if (blocked) {
      this.noise(0.045, 2600, 0.14);
      this.tone(430, 0.07, 0.09, 'square');
    } else {
      this.noise(heavy ? 0.11 : 0.065, heavy ? 850 : 1700, heavy ? 0.34 : 0.24);
      this.tone(heavy ? 78 : 135, heavy ? 0.16 : 0.10, heavy ? 0.30 : 0.20);
    }
  }

  /** M2 超必杀：更长的低频噪声 + 锯齿塌陷，和普通重击区分开。 */
  superMove(): void {
    if (!this.ctx) return;
    this.noise(0.22, 520, 0.30);
    this.tone(140, 0.34, 0.24, 'sawtooth');
  }

  announce(kind: 'fight' | 'ko' | 'round'): void {
    if (!this.ctx) return;
    if (kind === 'fight') this.tone(720, 0.16, 0.11, 'triangle');
    else if (kind === 'round') this.tone(520, 0.10, 0.07, 'triangle');
    else {
      this.noise(0.32, 320, 0.20);
      this.tone(92, 0.55, 0.24, 'sawtooth');
    }
  }
}
