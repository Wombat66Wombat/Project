// Hearing a sung, hummed or whistled note through the microphone.
// detectPitch is the YIN algorithm; NoteTracker turns a stream of pitches into notes.

/** Returns the fundamental frequency of `buf` in Hz, or null for silence/noise. */
export function detectPitch(buf, sampleRate, { minHz = 70, maxHz = 1400, threshold = 0.15, minRms = 0.012 } = {}) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < minRms) return null;

  const maxLag = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const W = buf.length - maxLag;
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let j = 0; j < W; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalised difference.
  const cmnd = new Float32Array(maxLag + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cmnd[tau] = running ? (d[tau] * tau) / running : 1;
  }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return null;
  // Parabolic interpolation for sub-sample accuracy.
  let better = tau;
  if (tau > 1 && tau < maxLag) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const denom = a + c - 2 * b;
    if (denom) better = tau + (a - c) / (2 * denom);
  }
  return sampleRate / better;
}

/**
 * Feed it one pitch reading (a MIDI number with cents, or null for silence) per frame.
 * It calls onStart(midi) once a note has been held steadily, and onEnd(midi, frames) when it stops.
 */
export class NoteTracker {
  constructor({ onStart, onEnd, stableFrames = 4, releaseFrames = 4 } = {}) {
    Object.assign(this, { onStart, onEnd, stableFrames, releaseFrames });
    this.current = null; // note being held
    this.candidate = null;
    this.candidateCount = 0;
    this.silent = 0;
    this.held = 0;
  }

  push(midiFloat) {
    const rounded = midiFloat == null ? null : Math.round(midiFloat);
    if (rounded == null) {
      this.candidate = null;
      this.candidateCount = 0;
      if (this.current != null && ++this.silent >= this.releaseFrames) this.end();
      return;
    }
    this.silent = 0;
    if (this.current != null && Math.abs(midiFloat - this.current) < 0.7) {
      this.held++;
      this.candidate = null;
      this.candidateCount = 0;
      return;
    }
    if (rounded === this.candidate) this.candidateCount++;
    else {
      this.candidate = rounded;
      this.candidateCount = 1;
    }
    if (this.candidateCount >= this.stableFrames) {
      if (this.current != null) this.end();
      this.current = rounded;
      this.held = this.candidateCount;
      this.candidate = null;
      this.candidateCount = 0;
      this.onStart?.(rounded);
    }
  }

  end() {
    if (this.current == null) return;
    const midi = this.current;
    this.current = null;
    this.onEnd?.(midi, this.held);
    this.held = 0;
  }
}

/** Starts listening to the microphone. Returns { stop() }. onFrame gets (midiFloat|null, level). */
export async function listenToMic(audioCtx, onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const src = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let running = true;
  const tick = () => {
    if (!running) return;
    analyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    const hz = detectPitch(buf, audioCtx.sampleRate);
    onFrame(hz ? 69 + 12 * Math.log2(hz / 440) : null, rms);
    setTimeout(tick, 30);
  };
  tick();
  return {
    stop() {
      running = false;
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
