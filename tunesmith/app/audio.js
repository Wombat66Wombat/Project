// Sound engine: every instrument is synthesised with the Web Audio API,
// so the app needs no sample files and works offline.

import { midiToFreq } from './theory.js';

export const INSTRUMENTS = [
  { id: 'piano', name: 'Piano', gm: 0 },
  { id: 'epiano', name: 'Electric piano', gm: 4 },
  { id: 'guitar', name: 'Acoustic guitar', gm: 25 },
  { id: 'strings', name: 'Strings', gm: 48 },
  { id: 'organ', name: 'Organ', gm: 16 },
  { id: 'choir', name: 'Choir "aah"', gm: 52 },
  { id: 'flute', name: 'Flute', gm: 73 },
  { id: 'synth', name: 'Synth lead', gm: 81 },
  { id: 'pad', name: 'Warm pad', gm: 89 },
  { id: 'bass', name: 'Bass', gm: 33 },
  { id: 'musicbox', name: 'Music box', gm: 10 },
  { id: 'marimba', name: 'Marimba', gm: 12 },
];

const now = (ctx) => ctx.currentTime;

function holdAt(param, t) {
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.voices = new Set();
    this.ksCache = new Map();
  }

  /** Creates the audio context on first use (browsers require a click first). */
  ensure() {
    if (!this.ctx) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.75;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);
      this.dry = ctx.createGain();
      this.dry.connect(this.master);
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.4);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.22;
      this.reverb.connect(this.wet).connect(this.master);
      this.noise = this.noiseBuffer(1);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get time() {
    return this.ensure().currentTime;
  }

  impulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Output stage of one voice: dry + reverb send. */
  out(time, reverb = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.connect(this.dry);
    const send = this.ctx.createGain();
    send.gain.value = reverb;
    g.connect(send).connect(this.reverb);
    return g;
  }

  osc(type, freq, time, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, time);
    o.detune.setValueAtTime(detune, time);
    o.start(time);
    return o;
  }

  vibrato(target, freq, time, { rate = 5.2, depth = 0.005, delay = 0.25 } = {}) {
    const lfo = this.osc('sine', rate, time);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(freq * depth, time + delay + 0.3);
    lfo.connect(g);
    for (const t of target) g.connect(t.frequency);
    return lfo;
  }

  /** Karplus–Strong plucked string, rendered once per note and cached. */
  pluckBuffer(midi) {
    const key = midi;
    if (this.ksCache.has(key)) return this.ksCache.get(key);
    const sr = this.ctx.sampleRate;
    const f = midiToFreq(midi);
    const len = Math.floor(sr * 2.6);
    const buf = this.ctx.createBuffer(1, len, sr);
    const y = buf.getChannelData(0);
    const D = sr / f - 0.5; // the averaging filter adds half a sample of delay
    const N = Math.ceil(D) + 2;
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const r = Math.random() * 2 - 1;
      prev = 0.6 * r + 0.4 * prev; // soften the attack
      y[i] = prev;
    }
    const decay = 0.9965 - Math.max(0, midi - 60) * 0.00012;
    for (let n = N; n < len; n++) {
      const p = n - D;
      const i0 = Math.floor(p);
      const frac = p - i0;
      const a = y[i0] * (1 - frac) + y[i0 + 1] * frac;
      const b = y[i0 - 1] * (1 - frac) + y[i0] * frac;
      y[n] = decay * 0.5 * (a + b);
    }
    this.ksCache.set(key, buf);
    return buf;
  }

  /**
   * Starts a note. Returns a voice; call voice.release(time) to let go.
   * With `duration` the release is scheduled straight away.
   */
  play(instrument, midi, { time, duration, velocity = 0.8 } = {}) {
    const ctx = this.ensure();
    const t = Math.max(time ?? now(ctx), now(ctx));
    const f = midiToFreq(midi);
    const v = velocity;
    const sources = [];
    let release = 0.25;
    let decaying = false;
    let out;

    const env = (a, peak, d, sustain) => {
      out.gain.setValueAtTime(0, t);
      out.gain.linearRampToValueAtTime(peak, t + a);
      if (d) out.gain.setTargetAtTime(peak * sustain, t + a, d / 3);
    };

    switch (instrument) {
      case 'piano': {
        out = this.out(t, 0.9);
        decaying = true;
        release = 0.18;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(f * 9, 9000), t);
        lp.frequency.setTargetAtTime(Math.min(f * 3, 5000), t + 0.01, 0.4);
        lp.connect(out);
        const amps = [1, 0.5, 0.28, 0.15, 0.08];
        amps.forEach((amp, k) => {
          const n = k + 1;
          const o = this.osc(k === 0 ? 'triangle' : 'sine', f * n * (1 + 0.0004 * n * n), t, k === 0 ? 0 : 3);
          const g = ctx.createGain();
          g.gain.value = amp * (midi > 72 ? 0.7 : 1);
          o.connect(g).connect(lp);
          sources.push(o);
        });
        const hammer = ctx.createBufferSource();
        hammer.buffer = this.noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = Math.min(f * 5, 6000);
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(0.25 * v, t);
        hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        hammer.connect(bp).connect(hg).connect(out);
        hammer.start(t);
        hammer.stop(t + 0.05);
        const sustainTime = Math.max(0.7, 4.2 - (midi - 36) * 0.055);
        out.gain.setValueAtTime(0, t);
        out.gain.linearRampToValueAtTime(0.32 * v, t + 0.004);
        out.gain.setTargetAtTime(0.13 * v, t + 0.004, 0.09);
        out.gain.setTargetAtTime(0, t + 0.3, sustainTime / 3);
        break;
      }
      case 'epiano': {
        out = this.out(t, 0.8);
        decaying = true;
        release = 0.2;
        const car = this.osc('sine', f, t);
        const mod = this.osc('sine', f, t);
        const idx = ctx.createGain();
        idx.gain.setValueAtTime(f * 2.2 * v, t);
        idx.gain.setTargetAtTime(f * 0.3, t, 0.35);
        mod.connect(idx).connect(car.frequency);
        const tine = this.osc('sine', f * 14, t);
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(0.06 * v, t);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        tine.connect(tg).connect(out);
        car.connect(out);
        sources.push(car, mod, tine);
        out.gain.setValueAtTime(0, t);
        out.gain.linearRampToValueAtTime(0.3 * v, t + 0.006);
        out.gain.setTargetAtTime(0, t + 0.05, Math.max(0.5, 2.2 - (midi - 48) * 0.03));
        break;
      }
      case 'guitar': {
        out = this.out(t, 0.7);
        decaying = true;
        release = 0.12;
        const src = ctx.createBufferSource();
        src.buffer = this.pluckBuffer(midi);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 3500;
        src.connect(lp).connect(out);
        src.start(t);
        sources.push(src);
        out.gain.setValueAtTime(0.55 * v, t);
        break;
      }
      case 'strings':
      case 'pad': {
        const pad = instrument === 'pad';
        out = this.out(t, 1.2);
        release = pad ? 1.2 : 0.5;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.min(f * (pad ? 3 : 6), 5000), t);
        lp.Q.value = pad ? 1.5 : 0.6;
        lp.connect(out);
        const oscs = (pad ? [-9, 0, 9] : [-7, 0, 7]).map((dt) => this.osc(pad ? 'triangle' : 'sawtooth', f, t, dt));
        if (pad) oscs.push(this.osc('sine', f / 2, t));
        oscs.forEach((o) => o.connect(lp));
        sources.push(...oscs, this.vibrato(oscs, f, t, { rate: pad ? 0.3 : 5.5, depth: pad ? 0.002 : 0.004, delay: 0.3 }));
        env(pad ? 0.6 : 0.22, (pad ? 0.16 : 0.1) * v, 0.6, 0.85);
        break;
      }
      case 'organ': {
        out = this.out(t, 0.8);
        release = 0.07;
        const parts = [[0.5, 0.45], [1, 1], [2, 0.6], [3, 0.35], [4, 0.3], [6, 0.12], [8, 0.1]];
        for (const [ratio, amp] of parts) {
          if (f * ratio > 12000) continue;
          const o = this.osc('sine', f * ratio, t);
          const g = ctx.createGain();
          g.gain.value = amp;
          o.connect(g).connect(out);
          sources.push(o);
        }
        const trem = this.osc('sine', 6.2, t);
        const tg = ctx.createGain();
        tg.gain.value = 0.012 * v;
        trem.connect(tg).connect(out.gain);
        sources.push(trem);
        env(0.012, 0.085 * v, 0, 1);
        break;
      }
      case 'choir': {
        out = this.out(t, 1.4);
        release = 0.45;
        const mix = ctx.createGain();
        const oscs = [-8, 0, 8].map((dt) => this.osc('sawtooth', f, t, dt));
        oscs.forEach((o) => o.connect(mix));
        for (const [fq, gain, q] of [[750, 1, 6], [1200, 0.55, 8], [2600, 0.25, 10]]) {
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = fq;
          bp.Q.value = q;
          const g = ctx.createGain();
          g.gain.value = gain;
          mix.connect(bp).connect(g).connect(out);
        }
        sources.push(...oscs, this.vibrato(oscs, f, t, { rate: 5, depth: 0.006, delay: 0.2 }));
        env(0.28, 0.42 * v, 0.5, 0.9);
        break;
      }
      case 'flute': {
        out = this.out(t, 1.1);
        release = 0.12;
        const o1 = this.osc('sine', f, t);
        const o2 = this.osc('triangle', f * 2, t);
        const g2 = ctx.createGain();
        g2.gain.value = 0.08;
        o1.connect(out);
        o2.connect(g2).connect(out);
        const breath = ctx.createBufferSource();
        breath.buffer = this.noise;
        breath.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f * 2;
        bp.Q.value = 1.5;
        const bg = ctx.createGain();
        bg.gain.setValueAtTime(0.35, t);
        bg.gain.setTargetAtTime(0.06, t + 0.05, 0.1);
        breath.connect(bp).connect(bg).connect(out);
        breath.start(t);
        sources.push(o1, o2, breath, this.vibrato([o1, o2], f, t, { rate: 5, depth: 0.006, delay: 0.3 }));
        env(0.06, 0.24 * v, 0.2, 0.85);
        break;
      }
      case 'synth': {
        out = this.out(t, 0.6);
        release = 0.15;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 5;
        lp.frequency.setValueAtTime(Math.min(f * 12, 12000), t);
        lp.frequency.setTargetAtTime(Math.min(f * 4, 6000), t, 0.15);
        lp.connect(out);
        const a = this.osc('sawtooth', f, t, -6);
        const b = this.osc('square', f, t, 6);
        const bg = ctx.createGain();
        bg.gain.value = 0.5;
        a.connect(lp);
        b.connect(bg).connect(lp);
        sources.push(a, b, this.vibrato([a, b], f, t, { rate: 5.5, depth: 0.004, delay: 0.4 }));
        env(0.01, 0.13 * v, 0.3, 0.7);
        break;
      }
      case 'bass': {
        out = this.out(t, 0.2);
        release = 0.1;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 2;
        lp.frequency.setValueAtTime(Math.min(f * 8, 2500), t);
        lp.frequency.setTargetAtTime(Math.min(f * 2.5, 900), t, 0.08);
        lp.connect(out);
        const saw = this.osc('sawtooth', f, t);
        const sub = this.osc('sine', f, t);
        saw.connect(lp);
        sub.connect(out);
        sources.push(saw, sub);
        env(0.006, 0.3 * v, 0.5, 0.55);
        break;
      }
      case 'musicbox': {
        out = this.out(t, 1.3);
        decaying = true;
        release = 0.4;
        [[1, 1, 1.4], [2.76, 0.35, 0.5], [5.4, 0.18, 0.25], [8.93, 0.08, 0.12]].forEach(([ratio, amp, dec]) => {
          const o = this.osc('sine', f * 2 * ratio, t);
          const g = ctx.createGain();
          g.gain.setValueAtTime(amp * 0.22 * v, t);
          g.gain.setTargetAtTime(0, t + 0.002, dec);
          o.connect(g).connect(out);
          sources.push(o);
        });
        out.gain.setValueAtTime(1, t);
        break;
      }
      case 'marimba': {
        out = this.out(t, 0.8);
        decaying = true;
        release = 0.15;
        [[1, 1, 0.45], [4, 0.3, 0.07], [10, 0.08, 0.02]].forEach(([ratio, amp, dec]) => {
          const o = this.osc('sine', f * ratio, t);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(amp * 0.4 * v, t + 0.002);
          g.gain.setTargetAtTime(0, t + 0.003, dec * Math.max(0.5, 1.4 - (midi - 48) * 0.015));
          o.connect(g).connect(out);
          sources.push(o);
        });
        out.gain.setValueAtTime(1, t);
        break;
      }
      default:
        return this.play('piano', midi, { time, duration, velocity });
    }

    const voice = {
      midi,
      stopped: false,
      release: (at) => {
        if (voice.stopped) return;
        voice.stopped = true;
        const rt = Math.max(at ?? now(ctx), t + 0.02);
        holdAt(out.gain, rt);
        out.gain.setTargetAtTime(0, rt, release / 3);
        const end = rt + release * 2.5 + 0.05;
        for (const s of sources) {
          try {
            s.stop(end);
          } catch {
            /* already stopped */
          }
        }
        setTimeout(() => {
          out.disconnect();
          this.voices.delete(voice);
        }, (end - now(ctx)) * 1000 + 200);
      },
    };
    // Plucked and struck sounds die away by themselves even if never released.
    if (decaying && duration == null) {
      const natural = t + 6;
      for (const s of sources) s.stop?.(natural);
    }
    this.voices.add(voice);
    if (duration != null) voice.release(t + duration);
    return voice;
  }

  /** A metronome tick. */
  click(time, accent = false) {
    const ctx = this.ensure();
    const o = this.osc('sine', accent ? 1600 : 1100, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.25 : 0.15, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    o.connect(g).connect(this.master);
    o.stop(time + 0.06);
  }

  /** Plays a voiced chord ([bass, ...upper]) for `seconds` in a style. */
  playChord(instrument, notes, time, seconds, style = 'block', velocity = 0.55) {
    const [bass, ...upper] = notes;
    const voices = [];
    const add = (m, at, dur, vel) => voices.push(this.play(instrument, m, { time: at, duration: dur, velocity: vel }));
    if (style === 'arpeggio') {
      const step = seconds / Math.max(2, Math.round(seconds / 0.3));
      const steps = Math.round(seconds / step);
      const pattern = [bass, ...upper, ...upper.slice(1, -1).reverse()];
      for (let i = 0; i < steps; i++) add(pattern[i % pattern.length], time + i * step, step * 1.6, i === 0 ? velocity : velocity * 0.8);
    } else if (style === 'strum') {
      [bass, ...upper].forEach((m, i) => add(m, time + i * 0.03, seconds - i * 0.03, velocity));
    } else if (style === 'pulse') {
      const beats = Math.max(1, Math.round(seconds / 0.5));
      const each = seconds / beats;
      add(bass, time, seconds * 0.98, velocity);
      for (let i = 0; i < beats; i++) upper.forEach((m) => add(m, time + i * each, each * 0.6, velocity * (i === 0 ? 0.9 : 0.7)));
    } else {
      add(bass, time, seconds * 0.98, velocity);
      upper.forEach((m) => add(m, time, seconds * 0.98, velocity * 0.85));
    }
    return voices;
  }

  stopAll() {
    if (!this.ctx) return;
    for (const v of [...this.voices]) v.release(now(this.ctx));
  }
}
