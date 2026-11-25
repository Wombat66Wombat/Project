// Tunesmith app: wires the piano, melody roll, chord tools and AI ideas together.

import * as T from './theory.js';
import { Engine, INSTRUMENTS } from './audio.js';
import { NoteTracker, listenToMic } from './pitch.js';
import * as G from './generator.js';
import { toMidi } from './midi.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.includes('-')) n.setAttribute(k, v);
    else n[k] = v;
  }
  for (const k of kids) n.append(k);
  return n;
};

const engine = new Engine();
const desktop = window.tunesmith || null;
const STORE = 'tunesmith.song.v1';

const DEFAULT_SONG = {
  melody: [],
  chords: [],
  bpm: 90,
  melodyInstrument: 'piano',
  chordInstrument: 'epiano',
  keyChoice: 'auto',
  chordStyle: 'block',
  beatsPerChord: 4,
  loop: false,
  metronome: false,
  mode: 'step',
  stepBeats: 1,
  showScale: true,
  engine: 'claude',
};

let song = loadSong();
const undoStack = [];
const redoStack = [];
const ui = {
  selected: null, // melody index
  octave: 4,
  pressed: new Map(), // midi → voice
  playing: null,
  proposal: null,
  lastTask: null,
  hum: null,
  live: null,
  glow: new Set(),
  noteRects: [],
  chordRects: [],
  aiStatus: { hasKey: false },
  seed: Date.now(),
};

// ---------- Persistence & history ----------

function loadSong() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...DEFAULT_SONG, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return structuredClone(DEFAULT_SONG);
}

function saveSong() {
  try {
    localStorage.setItem(STORE, JSON.stringify(song));
  } catch {
    /* storage unavailable */
  }
}

const snapshot = () => JSON.stringify({ melody: song.melody, chords: song.chords });

/** Changes the melody/chords with undo support. */
function commit(fn) {
  undoStack.push(snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  fn();
  saveSong();
  renderAll();
}

function restore(stackFrom, stackTo) {
  if (!stackFrom.length) return;
  stackTo.push(snapshot());
  const s = JSON.parse(stackFrom.pop());
  song.melody = s.melody;
  song.chords = s.chords;
  ui.selected = null;
  saveSong();
  renderAll();
}
const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

function setting(key, value) {
  song[key] = value;
  saveSong();
  renderAll();
}

// ---------- Key ----------

function detected() {
  return T.detectKey(song.melody, song.chords);
}

function currentKey() {
  if (song.keyChoice !== 'auto') return T.parseKey(song.keyChoice) || { tonic: 0, mode: 'major' };
  const ranked = detected();
  if (ranked.length) return ranked[0].key;
  const first = song.chords.find((c) => c.chord)?.chord;
  return first ? T.keyForChord(first) : { tonic: 0, mode: 'major' };
}

const flats = () => T.usesFlats(currentKey());
const nn = (midi) => T.noteName(midi, flats());
const cs = (chord) => T.chordSymbol(chord, flats());

// ---------- Helpers ----------

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

const secPerBeat = () => 60 / song.bpm;
const melodyBeats = () => T.totalBeats(song.melody);
const chordBeats = () => T.totalBeats(song.chords);

function chordVoices(chords) {
  let prev = null;
  return chords.map((c) => {
    if (!c.chord) return null;
    prev = T.voiceChord(c.chord, prev);
    return prev;
  });
}

function playChordNow(chord) {
  const notes = T.voiceChord(chord);
  engine.playChord(song.chordInstrument, notes, engine.time + 0.01, Math.min(2.2, secPerBeat() * 3), song.chordStyle === 'pulse' ? 'block' : song.chordStyle);
  glowChord(chord, 1400);
}

function glowChord(chord, ms) {
  ui.glow = new Set(chord ? T.chordPcs(chord) : []);
  renderPianoMarks();
  clearTimeout(glowChord.timer);
  glowChord.timer = setTimeout(() => {
    ui.glow = new Set();
    renderPianoMarks();
  }, ms);
}

// ---------- Playing notes (piano, computer keys, MIDI, humming) ----------

function noteDown(midi, { silent = false } = {}) {
  if (ui.pressed.has(midi)) return;
  const voice = silent ? null : engine.play(song.melodyInstrument, midi, { velocity: 0.85 });
  ui.pressed.set(midi, voice);
  setKeyDown(midi, true);
  if (ui.live?.recording) ui.live.notes.push({ midi, on: engine.time, off: null });
  else if (song.mode === 'step') {
    commit(() => {
      const ev = { midi, beats: song.stepBeats };
      if (ui.selected != null) {
        song.melody.splice(ui.selected + 1, 0, ev);
        ui.selected++;
      } else song.melody.push(ev);
    });
    scrollRollToEnd();
  }
}

function noteUp(midi) {
  if (!ui.pressed.has(midi)) return;
  ui.pressed.get(midi)?.release();
  ui.pressed.delete(midi);
  setKeyDown(midi, false);
  if (ui.live?.recording) {
    const n = [...ui.live.notes].reverse().find((x) => x.midi === midi && x.off == null);
    if (n) n.off = engine.time;
  }
}

// ---------- Piano ----------

const BLACK = new Set([1, 3, 6, 8, 10]);
const KEY_CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon'];
const KEY_LABEL = ['A', 'W', 'S', 'E', 'D', 'F', 'T', 'G', 'Y', 'H', 'U', 'J', 'K', 'O', 'L', 'P', ';'];

function pianoRange() {
  const lo = 12 * ui.octave; // e.g. octave 4 → C3
  return [lo, lo + 36];
}

function buildPiano() {
  const piano = $('#piano');
  piano.textContent = '';
  const [lo, hi] = pianoRange();
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
  const w = 100 / whites.length;
  let wi = 0;
  const kbBase = 12 * (ui.octave + 1);
  for (let m = lo; m <= hi; m++) {
    const black = BLACK.has(m % 12);
    const key = el('div', { className: black ? 'black' : 'white' });
    key.dataset.midi = m;
    if (black) {
      key.style.left = `calc(${wi * w}% - ${w * 0.32}%)`;
      key.style.width = `${w * 0.64}%`;
    } else {
      key.style.left = `${wi * w}%`;
      key.style.width = `${w}%`;
      wi++;
    }
    key.append(el('span', { className: 'mark hidden' }));
    const k = m - kbBase;
    if (k >= 0 && k < KEY_LABEL.length) key.append(el('span', { className: 'kbd', textContent: KEY_LABEL[k] }));
    if (m % 12 === 0) key.append(el('span', { className: 'cname', textContent: `C${m / 12 - 1}` }));
    piano.append(key);
  }
  renderPianoMarks();
}

function setKeyDown(midi, down) {
  $(`#piano [data-midi="${midi}"]`)?.classList.toggle('down', down);
}

function renderPianoMarks() {
  const key = currentKey();
  const scale = new Set(T.scalePcs(key));
  const show = song.showScale && (song.melody.length || song.chords.length || song.keyChoice !== 'auto');
  for (const k of $$('#piano [data-midi]')) {
    const pc = Number(k.dataset.midi) % 12;
    const mark = k.querySelector('.mark');
    mark.classList.toggle('hidden', !show || !scale.has(pc));
    mark.classList.toggle('tonic', pc === key.tonic);
    k.classList.toggle('glow', ui.glow.has(pc));
  }
}

function setupPianoInput() {
  const piano = $('#piano');
  let dragging = false;
  let current = null;
  const keyAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-midi]');
  piano.addEventListener('pointerdown', (e) => {
    const k = keyAt(e);
    if (!k) return;
    dragging = true;
    piano.setPointerCapture(e.pointerId);
    current = Number(k.dataset.midi);
    noteDown(current);
  });
  piano.addEventListener('pointermove', (e) => {
    if (!dragging || song.mode === 'step') return; // gliding adds notes only when not in "Add notes"
    const k = keyAt(e);
    const m = k ? Number(k.dataset.midi) : null;
    if (m !== current) {
      if (current != null) noteUp(current);
      current = m;
      if (m != null) noteDown(m);
    }
  });
  const end = () => {
    if (current != null) noteUp(current);
    current = null;
    dragging = false;
  };
  piano.addEventListener('pointerup', end);
  piano.addEventListener('pointercancel', end);
}

// ---------- Melody roll ----------

const ROLL = { gutter: 46, ruler: 22, melodyH: 270, chordH: 48 };

function proposalLayout() {
  const p = ui.proposal;
  if (!p) return null;
  if (p.kind === 'append') {
    const base = Math.max(melodyBeats(), chordBeats());
    return { melodyStart: base, chordStart: base, melody: p.melody || [], chords: p.chords || [] };
  }
  return { melodyStart: 0, chordStart: 0, melody: p.melody || [], chords: p.chords || [], replace: true };
}

function drawRoll(playBeat = null) {
  const canvas = $('#roll');
  const wrap = $('#rollWrap');
  const ppb = 58;
  const prop = proposalLayout();
  let total = Math.max(melodyBeats(), chordBeats());
  if (prop) total = Math.max(total, prop.melodyStart + T.totalBeats(prop.melody), prop.chordStart + T.totalBeats(prop.chords));
  const beats = Math.max(16, Math.ceil((total + 2) / 4) * 4);
  const cssW = Math.max(wrap.clientWidth - 2, ROLL.gutter + beats * ppb + 10);
  const cssH = ROLL.ruler + ROLL.melodyH + ROLL.chordH;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  $('#rollEmpty').classList.toggle('hidden', song.melody.length > 0 || song.chords.length > 0 || !!prop);

  const all = [...song.melody, ...(prop ? prop.melody : [])].filter((e) => e.midi != null).map((e) => e.midi);
  let lo = all.length ? Math.min(...all) - 3 : 57;
  let hi = all.length ? Math.max(...all) + 3 : 76;
  while (hi - lo < 16) {
    lo--;
    hi++;
  }
  const rowH = ROLL.melodyH / (hi - lo + 1);
  const key = currentKey();
  const scale = new Set(T.scalePcs(key));
  const x = (b) => ROLL.gutter + b * ppb;
  const y = (m) => ROLL.ruler + (hi - m) * rowH;
  const fl = flats();

  // Pitch rows.
  for (let m = lo; m <= hi; m++) {
    const pc = m % 12;
    g.fillStyle = pc === key.tonic ? '#2a2618' : scale.has(pc) ? '#191c24' : '#14161c';
    g.fillRect(ROLL.gutter, y(m), cssW, rowH);
    if (pc === 0 || pc === key.tonic || rowH >= 13) {
      g.fillStyle = pc === key.tonic ? '#ffb84d' : '#6d7385';
      g.font = `${pc === 0 ? 600 : 400} 10.5px system-ui`;
      g.textBaseline = 'middle';
      g.fillText(T.noteName(m, fl), 6, y(m) + rowH / 2);
    }
  }
  // Beat and bar lines.
  for (let b = 0; b <= beats; b++) {
    const bar = b % 4 === 0;
    g.fillStyle = bar ? '#353b4c' : '#20242f';
    g.fillRect(x(b), ROLL.ruler, 1, ROLL.melodyH + ROLL.chordH);
    if (bar && b < beats) {
      g.fillStyle = '#7d8396';
      g.font = '11px system-ui';
      g.textBaseline = 'middle';
      g.fillText(String(b / 4 + 1), x(b) + 5, ROLL.ruler / 2);
    }
  }
  g.fillStyle = '#20242f';
  g.fillRect(0, ROLL.ruler + ROLL.melodyH, cssW, 1);
  g.fillStyle = '#7d8396';
  g.font = '10.5px system-ui';
  g.fillText('Chords', 6, ROLL.ruler + ROLL.melodyH + ROLL.chordH / 2);

  const rr = (x0, y0, w, h, r) => {
    g.beginPath();
    g.roundRect ? g.roundRect(x0, y0, w, h, r) : g.rect(x0, y0, w, h);
  };

  // Melody notes.
  ui.noteRects = [];
  const dim = prop?.replace && prop.melody.length;
  let t = 0;
  song.melody.forEach((e, i) => {
    if (e.midi != null) {
      const rx = x(t) + 1, ry = y(e.midi) + 1, rw = e.beats * ppb - 2, rh = Math.max(rowH - 2, 4);
      const playingNow = playBeat != null && playBeat >= t && playBeat < t + e.beats && !ui.playing?.proposalOnly;
      rr(rx, ry, rw, rh, 4);
      g.fillStyle = dim ? 'rgba(255,184,77,.25)' : playingNow ? '#fff1d6' : '#ffb84d';
      g.fill();
      if (i === ui.selected) {
        g.lineWidth = 2;
        g.strokeStyle = '#ffffff';
        g.stroke();
      }
      if (rw > 24 && rh >= 8) {
        g.fillStyle = '#3a2500';
        g.font = `600 ${rh >= 11 ? 10.5 : 9.5}px system-ui`;
        g.textBaseline = 'middle';
        g.fillText(T.noteName(e.midi, fl), rx + 4, ry + rh / 2);
      }
      ui.noteRects.push({ i, x: rx, y: ry - 2, w: rw, h: rh + 4 });
    } else if (i === ui.selected) {
      g.strokeStyle = '#ffffff55';
      g.setLineDash([4, 4]);
      g.strokeRect(x(t) + 1, ROLL.ruler + 2, e.beats * ppb - 2, ROLL.melodyH - 4);
      g.setLineDash([]);
    }
    if (e.midi == null) ui.noteRects.push({ i, x: x(t), y: ROLL.ruler, w: e.beats * ppb, h: ROLL.melodyH, rest: true });
    t += e.beats;
  });

  // Chords lane.
  ui.chordRects = [];
  const cy = ROLL.ruler + ROLL.melodyH + 5, ch = ROLL.chordH - 10;
  const dimChords = prop?.replace && prop.chords.length;
  t = 0;
  song.chords.forEach((c, i) => {
    const cx = x(t) + 2, cw = c.beats * ppb - 4;
    rr(cx, cy, cw, ch, 7);
    g.fillStyle = !c.chord ? '#1d2028' : dimChords ? 'rgba(95,212,196,.18)' : playBeat != null && playBeat >= t && playBeat < t + c.beats ? '#b2fff3' : '#5fd4c4';
    g.fill();
    if (i === ui.menuChord) {
      g.lineWidth = 2;
      g.strokeStyle = '#fff';
      g.stroke();
    }
    g.fillStyle = c.chord ? '#002a25' : '#6d7385';
    g.font = '700 14px system-ui';
    g.textBaseline = 'middle';
    g.fillText(c.chord ? T.chordSymbol(c.chord, fl) : 'N.C.', cx + 8, cy + ch / 2 - (cw > 60 ? 6 : 0));
    if (c.chord && cw > 60) {
      g.font = '10.5px system-ui';
      g.fillStyle = '#0c4b44';
      g.fillText(T.romanFor(c.chord, key), cx + 8, cy + ch / 2 + 9);
    }
    ui.chordRects.push({ i, x: cx, y: cy, w: cw, h: ch });
    t += c.beats;
  });

  // Proposal (AI idea), drawn as a ghost in violet.
  if (prop) {
    let pt = prop.melodyStart;
    for (const e of prop.melody) {
      if (e.midi != null) {
        rr(x(pt) + 1, y(e.midi) + 1, e.beats * ppb - 2, Math.max(rowH - 2, 4), 4);
        const playingNow = playBeat != null && playBeat >= pt && playBeat < pt + e.beats;
        g.fillStyle = playingNow ? 'rgba(230,220,255,.9)' : 'rgba(182,156,255,.55)';
        g.fill();
        g.strokeStyle = '#b69cff';
        g.lineWidth = 1.5;
        g.stroke();
        if (e.beats * ppb > 26 && rowH >= 10) {
          g.fillStyle = '#1c1238';
          g.font = `600 ${rowH >= 13 ? 10.5 : 9.5}px system-ui`;
          g.textBaseline = 'middle';
          g.fillText(T.noteName(e.midi, fl), x(pt) + 5, y(e.midi) + rowH / 2);
        }
      }
      pt += e.beats;
    }
    pt = prop.chordStart;
    g.setLineDash([5, 3]);
    for (const c of prop.chords) {
      rr(x(pt) + 2, cy, c.beats * ppb - 4, ch, 7);
      g.fillStyle = 'rgba(182,156,255,.35)';
      g.fill();
      g.strokeStyle = '#b69cff';
      g.stroke();
      g.fillStyle = '#e6dcff';
      g.font = '700 14px system-ui';
      g.fillText(c.chord ? T.chordSymbol(c.chord, fl) : 'N.C.', x(pt) + 10, cy + ch / 2);
      pt += c.beats;
    }
    g.setLineDash([]);
  }

  // Playhead.
  if (playBeat != null) {
    g.fillStyle = '#ff6b6b';
    g.fillRect(x(playBeat), 0, 2, cssH);
  }
}

function scrollRollToEnd() {
  const wrap = $('#rollWrap');
  requestAnimationFrame(() => (wrap.scrollLeft = wrap.scrollWidth));
}

function setupRoll() {
  const canvas = $('#roll');
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const chordHit = ui.chordRects.find((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
    if (chordHit) {
      openChordMenu(chordHit.i, e.clientX, e.clientY);
      return;
    }
    const notes = ui.noteRects.filter((n) => px >= n.x && px <= n.x + n.w && py >= n.y && py <= n.y + n.h);
    const hit = notes.find((n) => !n.rest) || notes[0];
    if (hit) {
      ui.selected = hit.i;
      const ev = song.melody[hit.i];
      if (ev.midi != null) engine.play(song.melodyInstrument, ev.midi, { duration: Math.min(1, ev.beats * secPerBeat()) });
    } else ui.selected = null;
    renderAll();
  });
}

// ---------- Selection editing ----------

function editSelected(fn) {
  if (ui.selected == null || !song.melody[ui.selected]) return false;
  commit(() => fn(song.melody[ui.selected]));
  return true;
}

function deleteSelectedOrLast() {
  if (ui.selected != null && song.melody[ui.selected]) {
    commit(() => {
      song.melody.splice(ui.selected, 1);
      ui.selected = song.melody.length ? Math.min(ui.selected, song.melody.length - 1) : null;
      if (ui.selected != null && ui.selected > 0) ui.selected--;
    });
  } else if (song.melody.length) commit(() => song.melody.pop());
}

// ---------- Playback ----------

function buildPlayback({ preview = false } = {}) {
  let melody = song.melody;
  let chords = song.chords;
  let from = 0;
  const prop = preview ? proposalLayout() : null;
  if (prop) {
    if (prop.replace) {
      if (prop.melody.length) melody = prop.melody;
      if (prop.chords.length) chords = prop.chords;
    } else {
      const base = prop.melodyStart;
      melody = [...melody, ...(base > melodyBeats() ? [{ midi: null, beats: base - melodyBeats() }] : []), ...prop.melody];
      chords = [...chords, ...(base > chordBeats() ? [{ chord: null, beats: base - chordBeats() }] : []), ...prop.chords];
      from = Math.max(0, Math.floor((base - 4) / 4) * 4);
    }
  }
  return { melody, chords, from, end: Math.max(T.totalBeats(melody), T.totalBeats(chords)) };
}

function play({ preview = false } = {}) {
  stop();
  const pb = buildPlayback({ preview });
  if (pb.end <= 0) {
    toast('Nothing to play yet. Add some notes or chords first.');
    return;
  }
  const spb = secPerBeat();
  const start = engine.time + 0.08;
  const voices = [];
  const at = (beat) => start + (beat - pb.from) * spb;
  let t = 0;
  for (const e of pb.melody) {
    if (e.midi != null && t + e.beats > pb.from) {
      const s = Math.max(t, pb.from);
      voices.push(engine.play(song.melodyInstrument, e.midi, { time: at(s), duration: (t + e.beats - s) * spb * 0.95, velocity: 0.85 }));
    }
    t += e.beats;
  }
  t = 0;
  const voiced = chordVoices(pb.chords);
  pb.chords.forEach((c, i) => {
    if (c.chord && t + c.beats > pb.from) {
      const s = Math.max(t, pb.from);
      voices.push(...engine.playChord(song.chordInstrument, voiced[i], at(s), (t + c.beats - s) * spb, song.chordStyle));
    }
    t += c.beats;
  });
  if (song.metronome) for (let b = Math.ceil(pb.from); b < pb.end; b++) engine.click(at(b), b % 4 === 0);

  const playing = { start, from: pb.from, end: pb.end, preview, voices };
  ui.playing = playing;
  $('#playBtn').classList.add('hidden');
  const chordAtBeat = (beat) => {
    let tt = 0;
    for (const c of pb.chords) {
      if (beat < tt + c.beats) return c.chord;
      tt += c.beats;
    }
    return null;
  };
  let lastChord = null;
  const frame = () => {
    if (ui.playing !== playing) return;
    const beat = pb.from + (engine.time - start) / spb;
    if (beat >= pb.end) {
      if (song.loop && !preview) {
        play();
        return;
      }
      stop();
      return;
    }
    const c = chordAtBeat(beat);
    if (c !== lastChord) {
      lastChord = c;
      ui.glow = new Set(c ? T.chordPcs(c) : []);
      renderPianoMarks();
    }
    drawRoll(Math.max(pb.from, beat));
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function stop() {
  if (ui.playing) {
    for (const v of ui.playing.voices) v.release();
    ui.playing = null;
  }
  engine.stopAll();
  $('#playBtn').classList.remove('hidden');
  ui.glow = new Set();
  renderPianoMarks();
  drawRoll();
}

// ---------- Recording in time ----------

function toggleLiveRecording() {
  if (ui.live?.recording || ui.live?.countIn) return finishLiveRecording();
  const spb = secPerBeat();
  const t0 = engine.time + 0.15 + 4 * spb; // one bar of count-in
  ui.live = { t0, notes: [], countIn: true, recording: false };
  let nextBeat = 0;
  const tick = () => {
    if (!ui.live) return;
    // Schedule clicks a little ahead of time.
    while (t0 + (nextBeat - 4) * spb < engine.time + 0.2) {
      engine.click(t0 + (nextBeat - 4) * spb, nextBeat % 4 === 0);
      nextBeat++;
    }
    if (ui.live.countIn && engine.time >= t0 - 0.12) {
      ui.live.countIn = false;
      ui.live.recording = true;
      $('#modeHint').textContent = 'Recording… play your melody. Press ■ Stop when you’re done.';
    }
  };
  tick();
  ui.live.timer = setInterval(tick, 25);
  $('#modeHint').textContent = 'Get ready: 4 clicks, then play…';
  renderRecButton();
}

function finishLiveRecording() {
  const live = ui.live;
  if (!live) return;
  clearInterval(live.timer);
  ui.live = null;
  renderRecButton();
  renderModeHint();
  const spb = secPerBeat();
  const q = (sec) => Math.round(((sec - live.t0) / spb) * 2) / 2; // to the nearest half beat
  const notes = live.notes
    .map((n) => ({ midi: n.midi, s: Math.max(0, q(n.on)), e: Math.max(0, q(n.off ?? engine.time)) }))
    .sort((a, b) => a.s - b.s);
  if (!notes.length) {
    toast('No notes were recorded.');
    return;
  }
  const events = [];
  let cursor = notes[0].s; // start at the first note
  notes.forEach((n, i) => {
    if (n.s < cursor) return; // two notes at once: keep the first
    if (n.s > cursor) events.push({ midi: null, beats: n.s - cursor });
    const nextStart = notes.slice(i + 1).find((x) => x.s > n.s)?.s ?? Infinity;
    const beats = Math.max(0.5, Math.min(Math.max(n.e - n.s, 0.5), nextStart - n.s));
    events.push({ midi: n.midi, beats });
    cursor = n.s + beats;
  });
  commit(() => {
    // Line the new phrase up with the start of the next bar.
    const len = melodyBeats();
    const pad = len % 4 ? 4 - (len % 4) : 0;
    if (pad && song.melody.length) song.melody.push({ midi: null, beats: pad });
    song.melody.push(...events);
  });
  toast(`Added ${events.filter((e) => e.midi != null).length} notes. Click any note to fix it.`);
  scrollRollToEnd();
}

function renderRecButton() {
  const btn = $('#recBtn');
  btn.classList.toggle('hidden', song.mode !== 'live');
  const on = !!ui.live;
  btn.classList.toggle('recording', on);
  btn.textContent = on ? '■ Stop' : '● Record';
}

// ---------- Humming ----------

async function toggleHum() {
  if (ui.hum) {
    ui.hum.stop();
    ui.hum.tracker.end();
    ui.hum = null;
    $('#humBar').classList.add('hidden');
    $('#humBtn').classList.remove('toggle');
    $('#humBtn').removeAttribute('aria-pressed');
    return;
  }
  const ctx = engine.ensure();
  const tracker = new NoteTracker({
    onStart: (midi) => {
      $('#humNote').textContent = nn(midi);
      noteDown(midi, { silent: true });
    },
    onEnd: (midi) => noteUp(midi),
  });
  try {
    const mic = await listenToMic(ctx, (midiFloat) => {
      tracker.push(midiFloat);
      if (midiFloat == null) {
        $('#humText').textContent = 'Sing, hum or whistle one note at a time…';
        return;
      }
      const cents = Math.round((midiFloat - Math.round(midiFloat)) * 100);
      $('#humNeedle').style.left = `${50 + cents}%`;
      $('#humText').textContent = Math.abs(cents) < 15 ? 'in tune' : cents < 0 ? 'a little low' : 'a little high';
      if (tracker.current == null) $('#humNote').textContent = nn(Math.round(midiFloat));
    });
    ui.hum = { stop: mic.stop, tracker };
    $('#humBar').classList.remove('hidden');
    $('#humBtn').classList.add('toggle');
    $('#humBtn').setAttribute('aria-pressed', 'true');
    if (song.mode === 'listen') toast('Humming shows the notes. Choose “Add notes” to write them into the melody.', 4500);
  } catch (err) {
    toast(`Couldn't use the microphone: ${err.message || err}`, 5000);
  }
}

// ---------- MIDI keyboards ----------

async function setupMidi() {
  if (!navigator.requestMIDIAccess) return;
  try {
    const access = await navigator.requestMIDIAccess();
    const hook = () => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = ({ data }) => {
          const [status, note, vel] = data;
          const cmd = status & 0xf0;
          if (cmd === 0x90 && vel > 0) noteDown(note);
          else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) noteUp(note);
        };
      }
    };
    hook();
    access.onstatechange = (e) => {
      hook();
      if (e.port.type === 'input' && e.port.state === 'connected') toast(`MIDI keyboard connected: ${e.port.name}`);
    };
  } catch {
    /* no MIDI permission */
  }
}

// ---------- Chord tools ----------

function openChordMenu(index, cx, cy) {
  const menu = $('#chordMenu');
  const entry = song.chords[index];
  ui.menuChord = index;
  const key = currentKey();
  menu.textContent = '';
  const title = el('h4', { textContent: entry.chord ? cs(entry.chord) : 'No chord' });
  const sub = el('div', { className: 'sub', textContent: entry.chord ? `${T.chordLabel(entry.chord, flats())} · ${T.romanFor(entry.chord, key)} · ${T.describeChord(entry.chord, key)}` : 'Silence for the chords here' });
  const playBtn = el('button', { textContent: '▶ Hear it', onclick: () => entry.chord && playChordNow(entry.chord) });
  menu.append(title, sub, playBtn);

  const prev = song.chords.slice(0, index).reverse().find((c) => c.chord)?.chord || null;
  const pool = [...(entry.alternatives || []), ...T.nextChordSuggestions(prev, key, 6).map((s) => s.chord), T.enrichChord(entry.chord || { root: key.tonic, quality: 'maj' }, key)];
  const seen = new Set([entry.chord ? cs(entry.chord) : '']);
  const alts = pool.filter((c) => c && !seen.has(cs(c)) && seen.add(cs(c))).slice(0, 7);
  menu.append(el('div', { className: 'label', textContent: 'Try instead (click to hear, + to use)' }));
  const chips = el('div', { className: 'chips small' });
  for (const c of alts) {
    chips.append(
      chordChip(c, null, () => playChordNow(c), () => {
        commit(() => (song.chords[index] = { chord: c, beats: entry.beats, alternatives: entry.alternatives }));
        playChordNow(c);
        openChordMenu(index, cx, cy);
      }),
    );
  }
  menu.append(chips);

  menu.append(el('div', { className: 'label', textContent: 'Or type a chord' }));
  const form = el('form');
  const input = el('input', { placeholder: 'e.g. Fm7, Bb, G sus4' });
  form.append(input, el('button', { className: 'primary', textContent: 'Set' }));
  form.onsubmit = (e) => {
    e.preventDefault();
    const c = T.parseChord(input.value);
    if (!c) return toast(`I didn't understand “${input.value}”. Try C minor, Am, F#7 or Bb.`);
    commit(() => (song.chords[index] = { chord: c, beats: entry.beats }));
    playChordNow(c);
    openChordMenu(index, cx, cy);
  };
  menu.append(form);

  menu.append(el('div', { className: 'label', textContent: 'Length' }));
  const lens = el('div', { className: 'row' });
  for (const b of [1, 2, 4, 8]) {
    const btn = el('button', { textContent: `${b} beat${b > 1 ? 's' : ''}`, onclick: () => {
      commit(() => (song.chords[index].beats = b));
      openChordMenu(index, cx, cy);
    } });
    if (entry.beats === b) btn.className = 'toggle';
    btn.setAttribute('aria-pressed', String(entry.beats === b));
    lens.append(btn);
  }
  menu.append(lens);
  const actions = el('div', { className: 'row' });
  actions.append(
    el('button', { textContent: '✕ Remove chord', onclick: () => {
      commit(() => song.chords.splice(index, 1));
      closeChordMenu();
    } }),
    el('span', { className: 'spacer' }),
    el('button', { textContent: 'Done', onclick: closeChordMenu }),
  );
  menu.append(actions);

  menu.classList.remove('hidden');
  const w = 300, h = menu.offsetHeight;
  menu.style.left = `${Math.min(window.innerWidth - w - 10, Math.max(10, cx - w / 2))}px`;
  menu.style.top = `${cy + h + 16 > window.innerHeight ? Math.max(10, cy - h - 12) : cy + 12}px`;
  drawRoll();
}

function closeChordMenu() {
  $('#chordMenu').classList.add('hidden');
  ui.menuChord = null;
  drawRoll();
}

/** A chord button: click the name to hear it, "+" to use it. */
function chordChip(chord, why, onPlay, onAdd) {
  const chip = el('div', { className: 'chip' });
  const main = el('button', { className: 'main', title: 'Click to hear it', onclick: onPlay });
  main.append(el('span', { className: 'sym', textContent: cs(chord) }));
  if (why) main.append(el('span', { className: 'why', textContent: why }));
  chip.append(main);
  if (onAdd) chip.append(el('button', { className: 'add', textContent: '+', title: 'Add to my song', 'aria-label': `Add ${cs(chord)}`, onclick: onAdd }));
  return chip;
}

/** Chords to cover the melody by repeating a progression. */
function fillWithProgression(chords) {
  const bpc = song.beatsPerChord;
  const target = Math.max(melodyBeats(), chords.length * bpc);
  const out = [];
  for (let t = 0, i = 0; t < target - 1e-9; t += bpc, i++) out.push({ chord: chords[i % chords.length], beats: Math.min(bpc, target - t) });
  return out;
}

function previewProgression(chords) {
  stop();
  const spb = secPerBeat();
  const start = engine.time + 0.05;
  let prev = null;
  const voices = [];
  chords.forEach((c, i) => {
    prev = T.voiceChord(c, prev);
    voices.push(...engine.playChord(song.chordInstrument, prev, start + i * 4 * spb, 4 * spb, song.chordStyle));
  });
  ui.playing = { voices, start, from: 0, end: 0 };
  // Light up each chord's notes on the piano as it plays.
  chords.forEach((c, i) => setTimeout(() => glowChord(c, 4 * spb * 1000), i * 4 * spb * 1000 + 50));
}

function renderChordPanel() {
  const key = currentKey();
  const last = [...song.chords].reverse().find((c) => c.chord)?.chord || null;
  const next = $('#nextChips');
  next.textContent = '';
  if (last) {
    $('#nextTitle').textContent = `What could come after ${cs(last)}?`;
    for (const s of T.nextChordSuggestions(last, key, 6)) {
      next.append(chordChip(s.chord, s.why, () => playChordNow(s.chord), () => {
        commit(() => song.chords.push({ chord: s.chord, beats: song.beatsPerChord }));
        playChordNow(s.chord);
      }));
    }
  } else {
    $('#nextTitle').textContent = `Chords that belong to ${T.keyName(key)}`;
    const seen = new Set();
    for (const { chord } of T.keyChords(key)) {
      if (seen.has(cs(chord))) continue;
      seen.add(cs(chord));
      next.append(chordChip(chord, T.describeChord(chord, key), () => playChordNow(chord), () => {
        commit(() => song.chords.push({ chord, beats: song.beatsPerChord }));
        playChordNow(chord);
      }));
    }
  }

  const ideas = $('#ideas');
  ideas.textContent = '';
  const first = song.chords.find((c) => c.chord)?.chord || null;
  const ideaKey = first ? T.keyForChord(first, key) : key;
  for (const idea of T.progressionIdeas(ideaKey, first)) {
    const prog = el('div', { className: 'prog' });
    idea.chords.forEach((c, i) => {
      const s = el('span', { textContent: T.chordSymbol(c, T.usesFlats(ideaKey)) });
      s.append(el('small', { textContent: idea.romans[i] }));
      prog.append(s);
    });
    ideas.append(
      el('div', { className: 'idea' },
        el('span', { className: 'name', textContent: idea.name }),
        prog,
        el('button', { textContent: '▶', title: 'Listen', 'aria-label': `Listen to ${idea.name}`, onclick: () => previewProgression(idea.chords) }),
        el('button', { textContent: 'Use', onclick: () => {
          commit(() => (song.chords = fillWithProgression(idea.chords)));
          toast(song.melody.length ? `Using “${idea.name}”, repeated under your melody. Press Play to hear it.` : `Using “${idea.name}”. Press Play, or hum a melody over it.`);
        } }),
      ),
    );
  }
}

function startWithChord(text) {
  const chord = T.parseChord(text);
  if (!chord) {
    toast(`I didn't understand “${text}”. Try something like C minor, Am, F#7 or Bb.`, 4500);
    return;
  }
  const key = T.keyForChord(chord, song.melody.length ? currentKey() : null);
  commit(() => {
    if (song.melody.length) song.chords = T.harmonize(song.melody, key, { beatsPerChord: song.beatsPerChord, startChord: chord });
    else song.chords = [{ chord, beats: song.beatsPerChord }];
  });
  playChordNow(chord);
  toast(song.melody.length ? `Chords for your melody, starting on ${cs(chord)}.` : `Starting on ${cs(chord)} (${T.keyName(key)}). Pick what comes next below, or use a progression idea.`, 4500);
}

function harmonizeMelody() {
  if (!song.melody.some((e) => e.midi != null)) {
    toast('Add a melody first (choose “Add notes” and play), or start with a chord.');
    return;
  }
  const key = currentKey();
  const startChord = song.chords[0]?.chord && song.chords.length === 1 ? song.chords[0].chord : null;
  commit(() => (song.chords = T.harmonize(song.melody, key, { beatsPerChord: song.beatsPerChord, startChord })));
  toast(`Chords in ${T.keyName(key)}: ${song.chords.map((c) => cs(c.chord)).join(' – ')}. Click a chord on the timeline to swap it.`, 6000);
}

// ---------- AI ideas ----------

function songForAI() {
  const key = currentKey();
  const instName = (id) => INSTRUMENTS.find((i) => i.id === id)?.name || id;
  return {
    key: T.keyName(key),
    bpm: song.bpm,
    melodyInstrument: instName(song.melodyInstrument),
    chordInstrument: instName(song.chordInstrument),
    melody: song.melody.map((e) => ({ note: e.midi == null ? 'rest' : nn(e.midi), beats: e.beats })),
    chords: song.chords.map((c) => ({ chord: c.chord ? cs(c.chord) : 'N.C.', beats: c.beats })),
  };
}

const roundBeats = (b) => Math.min(16, Math.max(0.25, Math.round(Number(b) * 4) / 4 || 1));

function fromClaude(data) {
  const melody = [];
  for (const n of data.melody || []) {
    if (String(n.note).toLowerCase() === 'rest') melody.push({ midi: null, beats: roundBeats(n.beats) });
    else {
      const midi = T.parseNoteName(n.note);
      if (midi != null) melody.push({ midi, beats: roundBeats(n.beats) });
    }
  }
  const chords = [];
  for (const c of data.chords || []) {
    if (T.isNoChord(c.chord)) chords.push({ chord: null, beats: roundBeats(c.beats) });
    else {
      const chord = T.parseChord(c.chord);
      if (chord) chords.push({ chord, beats: roundBeats(c.beats) });
    }
  }
  return { kind: data.apply === 'replace' ? 'replace' : 'append', melody, chords, explanation: data.explanation || '', source: 'Claude' };
}

function builtinIdea(task) {
  const key = currentKey();
  const seed = (ui.seed = ui.seed + 7919);
  const chordList = (chords) => chords.map((c) => cs(c.chord)).join(' – ');
  if (task === 'continue') {
    const bars = Number($('#barsSelect').value);
    const { melody, chords } = G.continueMelody(song.melody, key, song.chords, { bars, seed, beatsPerChord: song.beatsPerChord });
    return { kind: 'append', melody, chords, source: 'Built-in', explanation: `${bars} more bars built from your own rhythms and note steps, landing on chord notes on the strong beats and ending on the home note ${T.pcName(key.tonic, flats())}. Chords: ${chordList(chords)}.` };
  }
  if (task === 'variation') {
    if (!song.melody.length) return null;
    return { kind: 'replace', melody: G.varyMelody(song.melody, key, { seed }), chords: [], source: 'Built-in', explanation: 'Same tune with a few decorations: passing notes fill the jumps, little turns around long notes, and some dotted rhythms. The ending stays the same.' };
  }
  if (task === 'chords') {
    if (!song.melody.length && !song.chords.length) return null;
    const plain = !song.chords.length || song.chords.every((c) => !c.chord || T.QUALITIES[c.chord.quality].iv.length === 3);
    if (song.chords.length && plain && ui.lastTask !== 'chords') {
      const chords = G.richerChords(song.chords, key);
      return { kind: 'replace', melody: [], chords, source: 'Built-in', explanation: `Your chords with extra colour notes (sevenths and ninths), which sound fuller and softer: ${chordList(chords)}.` };
    }
    if (!song.melody.length) return null;
    const chords = G.reharmonize(song.melody, key, song.chords, song.beatsPerChord);
    return { kind: 'replace', melody: [], chords, source: 'Built-in', explanation: `A different set of chords that still fits your melody: ${chordList(chords)}.` };
  }
  return null;
}

const useClaude = () => !!desktop && song.engine === 'claude';

async function runAI(task) {
  if (task === 'free' && !useClaude()) {
    if (!desktop) toast('Free-form requests need Claude, which works in the desktop app.');
    else {
      setting('engine', 'claude');
      toast('Switched to Claude for free-form requests.');
    }
    if (!desktop) return;
  }
  if (task === 'free' && !$('#aiRequest').value.trim()) {
    toast('Type what you would like first, e.g. “write a chorus that goes higher”.');
    $('#aiRequest').focus();
    return;
  }
  if (!song.melody.length && !song.chords.length && task !== 'free') {
    toast('Play a few notes or pick a chord first, so there is something to build on.');
    return;
  }
  stop();
  if (!useClaude()) {
    const idea = builtinIdea(task);
    ui.lastTask = task;
    if (!idea) return toast('Add a melody first for this one.');
    showProposal(idea, task);
    return;
  }
  if (!ui.aiStatus.hasKey) {
    toast('Add your Claude API key first. Opening Settings…');
    openSettings();
    return;
  }
  const busy = $('#aiBusy');
  busy.classList.remove('hidden');
  $('#aiBusyText').textContent = { continue: 'Claude is writing the next bars…', variation: 'Claude is writing a variation…', chords: 'Claude is choosing chords…', free: 'Claude is working on it…' }[task];
  $$('.ai-buttons button').forEach((b) => (b.disabled = true));
  try {
    const res = await desktop.suggest({ task, request: $('#aiRequest').value, bars: Number($('#barsSelect').value), song: songForAI() });
    if (!res.ok) {
      toast(res.error, 6000);
      if (res.needsKey) openSettings();
      return;
    }
    const idea = fromClaude(res.data);
    if (!idea.melody.length && !idea.chords.length) {
      toast('Claude’s answer had no music in it. Try again or rephrase.');
      return;
    }
    ui.lastTask = task;
    showProposal(idea, task);
  } catch (err) {
    toast(`Something went wrong: ${err.message || err}`);
  } finally {
    busy.classList.add('hidden');
    $$('.ai-buttons button').forEach((b) => (b.disabled = false));
  }
}

function showProposal(idea, task) {
  ui.proposal = { ...idea, task };
  renderProposal();
  drawRoll();
  const wrap = $('#rollWrap');
  if (idea.kind === 'append') scrollRollToEnd();
  else wrap.scrollLeft = 0;
  play({ preview: true });
}

function renderProposal() {
  const p = ui.proposal;
  $('#proposal').classList.toggle('hidden', !p);
  if (!p) return;
  $('#proposalSource').textContent = p.source;
  const what = { continue: 'Next bars', variation: 'Melody variation', chords: 'New chords', free: 'Your request' }[p.task] || 'Idea';
  $('#proposalTitle').textContent = `${what} · ${p.kind === 'append' ? 'added at the end' : 'replaces the current ' + [p.melody.length && 'melody', p.chords.length && 'chords'].filter(Boolean).join(' and ')}`;
  $('#proposalText').textContent = p.explanation;
  const chips = $('#proposalChords');
  chips.textContent = '';
  for (const c of p.chords.filter((c) => c.chord)) chips.append(chordChip(c.chord, null, () => playChordNow(c.chord)));
}

function acceptProposal() {
  const p = ui.proposal;
  if (!p) return;
  stop();
  commit(() => {
    if (p.kind === 'replace') {
      if (p.melody.length) song.melody = p.melody;
      if (p.chords.length) song.chords = p.chords;
    } else {
      const base = Math.max(melodyBeats(), chordBeats());
      if (p.melody.length && base > melodyBeats()) song.melody.push({ midi: null, beats: base - melodyBeats() });
      if (p.chords.length && base > chordBeats()) song.chords.push({ chord: null, beats: base - chordBeats() });
      song.melody.push(...p.melody);
      song.chords.push(...p.chords);
    }
    ui.proposal = null;
  });
  toast('Added to your song. Undo brings back the old version.');
}

function discardProposal() {
  stop();
  ui.proposal = null;
  renderProposal();
  drawRoll();
}

// ---------- Settings ----------

async function refreshAIStatus() {
  if (!desktop) return;
  ui.aiStatus = await desktop.aiStatus();
  renderEngine();
}

function renderEngine() {
  const engineSeg = $('#engineSeg');
  for (const b of engineSeg.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.engine === (useClaude() ? 'claude' : 'builtin')));
  const note = $('#engineNote');
  if (!desktop) {
    engineSeg.querySelector('[data-engine="claude"]').disabled = true;
    note.textContent = 'Using the built-in idea engine. Claude is available in the desktop app.';
  } else if (useClaude()) {
    note.textContent = ui.aiStatus.hasKey ? 'Claude writes melodies and chords that fit your song. It listens to your request below.' : '';
    if (!ui.aiStatus.hasKey) {
      note.append('Claude needs your API key. ', el('a', { href: '#', textContent: 'Add it in Settings', onclick: (e) => (e.preventDefault(), openSettings()) }), ' or switch to Built-in (works offline).');
    }
  } else note.textContent = 'Built-in: instant ideas from your own melody, offline. Switch to Claude for richer ideas and free-form requests.';
  $('#askBtn').classList.toggle('hidden', !desktop);
}

async function openSettings() {
  const dlg = $('#settings');
  const status = $('#keyStatus');
  if (!desktop) {
    status.textContent = 'Claude works in the desktop app. In the browser, the built-in idea engine is used.';
    status.className = 'status warn';
    $('#keyInput').disabled = true;
  } else {
    await refreshAIStatus();
    status.textContent = ui.aiStatus.saved ? `✓ A key is saved${ui.aiStatus.secure ? ' (encrypted)' : ''}.` : ui.aiStatus.hasKey ? '✓ Using the ANTHROPIC_API_KEY environment variable.' : 'No key saved yet.';
    status.className = `status ${ui.aiStatus.hasKey ? 'ok' : 'warn'}`;
  }
  if (!dlg.open) dlg.showModal();
}

// ---------- Files ----------

async function saveFile(name, data, mime, filters) {
  if (desktop) return desktop.saveFile(name, data, filters);
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = el('a', { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true };
}

async function saveSongFile() {
  const text = JSON.stringify({ app: 'tunesmith', version: 1, song }, null, 2);
  const res = await saveFile('My song.tunesmith', text, 'application/json', [{ name: 'Tunesmith song', extensions: ['tunesmith'] }]);
  if (res?.ok) toast('Song saved.');
}

function loadSongText(text) {
  try {
    const data = JSON.parse(text);
    const s = data.song || data;
    if (!Array.isArray(s.melody) || !Array.isArray(s.chords)) throw new Error('not a Tunesmith song');
    commit(() => {
      Object.assign(song, DEFAULT_SONG, s);
    });
    applySettingsToControls();
    renderAll();
    toast('Song opened.');
  } catch (err) {
    toast(`Couldn't open that file: ${err.message}`);
  }
}

async function openSongFile() {
  if (desktop) {
    const res = await desktop.openFile();
    if (res.ok) loadSongText(res.text);
    return;
  }
  const input = el('input', { type: 'file', accept: '.tunesmith,.json' });
  input.onchange = async () => input.files[0] && loadSongText(await input.files[0].text());
  input.click();
}

async function exportMidi() {
  if (!song.melody.length && !song.chords.length) return toast('Nothing to export yet.');
  const gm = (id) => INSTRUMENTS.find((i) => i.id === id)?.gm ?? 0;
  const bytes = toMidi({ bpm: song.bpm, melody: song.melody, chords: song.chords, melodyProgram: gm(song.melodyInstrument), chordProgram: gm(song.chordInstrument) });
  const res = await saveFile('My song.mid', bytes, 'audio/midi', [{ name: 'MIDI file', extensions: ['mid'] }]);
  if (res?.ok) toast('MIDI file saved. Open it in GarageBand, Logic, MuseScore or any music app.');
}

// ---------- Rendering ----------

function renderModeHint() {
  const hints = {
    listen: 'Play freely to find the tune: nothing is written down. Use the mouse, a MIDI keyboard, or your computer keys (A W S E D F T G Y H U J K).',
    step: 'Every note you play is added to the melody, one after another. Pick the length first. Wrong note? Press Backspace, or click it and use ↑ ↓.',
    live: 'Press ● Record, wait for 4 clicks, then play in time. Tunesmith tidies up the timing for you.',
  };
  $('#modeHint').textContent = hints[song.mode];
}

function renderTop() {
  const ranked = detected();
  const sel = $('#keySelect');
  const auto = sel.querySelector('option[value="auto"]');
  if (song.keyChoice === 'auto') {
    const k = currentKey();
    auto.textContent = ranked.length || song.chords.length ? `Auto: ${T.keyName(k)}` : 'Auto (play to detect)';
    const close = ranked.length > 1 && ranked[0].score - ranked[1].score < 0.04;
    $('#keyHint').textContent = close ? `or ${T.keyName(ranked[1].key)}?` : '';
  } else {
    auto.textContent = 'Auto';
    $('#keyHint').textContent = '';
  }
  sel.value = song.keyChoice;
  $('#loopBtn').setAttribute('aria-pressed', String(song.loop));
  $('#metroBtn').setAttribute('aria-pressed', String(song.metronome));
  $('#undoBtn').disabled = !undoStack.length;
  $('#redoBtn').disabled = !redoStack.length;
  $('#delBtn').disabled = ui.selected == null;
  const selected = ui.selected != null && song.melody[ui.selected];
  $('#selHint').textContent = selected
    ? `Selected: ${selected.midi == null ? 'pause' : nn(selected.midi)}, ${selected.beats} beat${selected.beats === 1 ? '' : 's'} · ↑ ↓ pitch · Shift ← → length · ← → next note · Delete removes`
    : 'Click a note to fix it: ↑ ↓ change pitch · Shift ← → change length · Delete removes';
}

function renderSegs() {
  for (const b of $$('#modeSeg button')) b.setAttribute('aria-checked', String(b.dataset.mode === song.mode));
  for (const b of $$('#lenSeg button')) b.setAttribute('aria-checked', String(Number(b.dataset.beats) === song.stepBeats));
  $('#lenSeg').classList.toggle('hidden', song.mode !== 'step');
  $('#restBtn').classList.toggle('hidden', song.mode !== 'step');
}

function renderAll() {
  renderTop();
  renderSegs();
  renderRecButton();
  renderPianoMarks();
  renderChordPanel();
  renderEngine();
  renderProposal();
  drawRoll();
}

function applySettingsToControls() {
  $('#bpm').value = song.bpm;
  $('#melodyInst').value = song.melodyInstrument;
  $('#chordInst').value = song.chordInstrument;
  $('#chordStyle').value = song.chordStyle;
  $('#chordEvery').value = String(song.beatsPerChord);
  $('#scaleToggle').checked = song.showScale;
  renderModeHint();
}

// ---------- Setup ----------

function setup() {
  for (const sel of [$('#melodyInst'), $('#chordInst')]) for (const inst of INSTRUMENTS) sel.append(el('option', { value: inst.id, textContent: inst.name }));
  const keySel = $('#keySelect');
  keySel.append(el('option', { value: 'auto', textContent: 'Auto' }));
  for (const mode of ['major', 'minor']) {
    const group = el('optgroup', { label: mode === 'major' ? 'Major (brighter)' : 'Minor (darker)' });
    for (let pc = 0; pc < 12; pc++) group.append(el('option', { value: T.keyName({ tonic: pc, mode }), textContent: T.keyName({ tonic: pc, mode }) }));
    keySel.append(group);
  }
  applySettingsToControls();
  buildPiano();
  setupPianoInput();
  setupRoll();

  keySel.onchange = () => setting('keyChoice', keySel.value);
  $('#bpm').onchange = () => setting('bpm', Math.min(220, Math.max(40, Number($('#bpm').value) || 90)));
  $('#melodyInst').onchange = (e) => {
    setting('melodyInstrument', e.target.value);
    engine.play(song.melodyInstrument, 60 + currentKey().tonic, { duration: 0.6 });
  };
  $('#chordInst').onchange = (e) => {
    setting('chordInstrument', e.target.value);
    playChordNow(song.chords.find((c) => c.chord)?.chord || { root: currentKey().tonic, quality: currentKey().mode === 'minor' ? 'min' : 'maj' });
  };
  $('#chordStyle').onchange = (e) => setting('chordStyle', e.target.value);
  $('#chordEvery').onchange = (e) => setting('beatsPerChord', Number(e.target.value));
  $('#scaleToggle').onchange = (e) => setting('showScale', e.target.checked);
  $('#loopBtn').onclick = () => setting('loop', !song.loop);
  $('#metroBtn').onclick = () => setting('metronome', !song.metronome);
  $('#playBtn').onclick = () => play();
  $('#stopBtn').onclick = () => stop();
  $('#modeSeg').onclick = (e) => {
    const m = e.target.closest('button')?.dataset.mode;
    if (!m) return;
    if (ui.live) finishLiveRecording();
    setting('mode', m);
    renderModeHint();
  };
  $('#lenSeg').onclick = (e) => {
    const b = e.target.closest('button')?.dataset.beats;
    if (b) setting('stepBeats', Number(b));
  };
  $('#recBtn').onclick = toggleLiveRecording;
  $('#restBtn').onclick = () => commit(() => song.melody.push({ midi: null, beats: song.stepBeats }));
  $('#humBtn').onclick = toggleHum;
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  $('#delBtn').onclick = deleteSelectedOrLast;
  $('#clearMelodyBtn').onclick = () => song.melody.length && commit(() => ((song.melody = []), (ui.selected = null)));
  $('#octDown').onclick = () => shiftOctave(-1);
  $('#octUp').onclick = () => shiftOctave(1);
  $('#startForm').onsubmit = (e) => {
    e.preventDefault();
    startWithChord($('#startInput').value);
  };
  $('#harmonizeBtn').onclick = harmonizeMelody;
  $('#clearChordsBtn').onclick = () => song.chords.length && commit(() => (song.chords = []));
  $$('[data-ai]').forEach((b) => (b.onclick = () => runAI(b.dataset.ai)));
  $('#engineSeg').onclick = (e) => {
    const v = e.target.closest('button')?.dataset.engine;
    if (v) setting('engine', v);
  };
  $('#previewBtn').onclick = () => play({ preview: true });
  $('#acceptBtn').onclick = acceptProposal;
  $('#discardBtn').onclick = discardProposal;
  $('#retryBtn').onclick = () => ui.proposal && runAI(ui.proposal.task);
  $('#newBtn').onclick = () => {
    if ((song.melody.length || song.chords.length) && !confirm('Start a new song? (Undo can bring this one back.)')) return;
    commit(() => {
      song.melody = [];
      song.chords = [];
      song.keyChoice = 'auto';
      ui.proposal = null;
      ui.selected = null;
    });
  };
  $('#saveBtn').onclick = saveSongFile;
  $('#openBtn').onclick = openSongFile;
  $('#midiBtn').onclick = exportMidi;
  $('#settingsBtn').onclick = openSettings;
  $('#saveKeyBtn').onclick = async (e) => {
    e.preventDefault();
    const key = $('#keyInput').value.trim();
    if (!key) return toast('Paste your API key first.');
    await desktop.setKey(key);
    $('#keyInput').value = '';
    setting('engine', 'claude');
    await openSettings();
    toast('Key saved. Claude is ready.');
  };
  $('#removeKeyBtn').onclick = async (e) => {
    e.preventDefault();
    if (!desktop) return;
    await desktop.setKey(null);
    await openSettings();
  };

  document.addEventListener('pointerdown', (e) => {
    const menu = $('#chordMenu');
    if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target.id !== 'roll') closeChordMenu();
  });
  window.addEventListener('resize', () => drawRoll());
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => [...ui.pressed.keys()].forEach(noteUp));

  setupMidi();
  refreshAIStatus();
  renderAll();
  window.__tunesmithReady = true;
}

function shiftOctave(d) {
  ui.octave = Math.max(2, Math.min(6, ui.octave + d));
  buildPiano();
}

const typing = (e) => e.target.closest?.('input, textarea, select, dialog');

function onKeyDown(e) {
  if (typing(e)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && e.code === 'KeyY') return (e.preventDefault(), redo());
  if (mod) return;
  if (e.code === 'Escape') {
    ui.selected = null;
    closeChordMenu();
    return renderAll();
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (e.repeat) return;
    return ui.playing ? stop() : play();
  }
  if (e.code === 'Backspace' || e.code === 'Delete') {
    e.preventDefault();
    return deleteSelectedOrLast();
  }
  if (ui.selected != null && song.melody[ui.selected]) {
    const ev = song.melody[ui.selected];
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      e.preventDefault();
      if (ev.midi == null) return;
      editSelected((n) => (n.midi = Math.max(21, Math.min(108, n.midi + (e.code === 'ArrowUp' ? (e.shiftKey ? 12 : 1) : e.shiftKey ? -12 : -1)))));
      engine.play(song.melodyInstrument, song.melody[ui.selected].midi, { duration: 0.5 });
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const dir = e.code === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        const steps = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
        const i = steps.findIndex((s) => s >= ev.beats);
        return editSelected((n) => (n.beats = steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? steps.length - 1 : i) + dir))]));
      }
      ui.selected = Math.max(0, Math.min(song.melody.length - 1, ui.selected + dir));
      const s = song.melody[ui.selected];
      if (s.midi != null) engine.play(song.melodyInstrument, s.midi, { duration: 0.4 });
      return renderAll();
    }
  }
  if (e.code === 'KeyZ') return shiftOctave(-1);
  if (e.code === 'KeyX') return shiftOctave(1);
  const k = KEY_CODES.indexOf(e.code);
  if (k >= 0) {
    e.preventDefault();
    if (!e.repeat) noteDown(12 * (ui.octave + 1) + k);
  }
}

function onKeyUp(e) {
  const k = KEY_CODES.indexOf(e.code);
  if (k >= 0) {
    // Release whichever octave the key started in.
    for (const m of [...ui.pressed.keys()]) if ((m - k) % 12 === 0 && Math.abs(m - (12 * (ui.octave + 1) + k)) <= 12) noteUp(m);
  }
}

setup();
