import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, NoteTracker } from '../app/pitch.js';
import { continueMelody, varyMelody, richerChords } from '../app/generator.js';
import { toMidi } from '../app/midi.js';
import { parseKey, parseNoteName, scalePcs, totalBeats, chordSymbol, parseChord } from '../app/theory.js';

const sine = (hz, sr = 44100, n = 2048, harmonics = [1]) => {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) harmonics.forEach((a, k) => (b[i] += 0.3 * a * Math.sin((2 * Math.PI * hz * (k + 1) * i) / sr)));
  return b;
};

test('detects the pitch of sung-like tones', () => {
  for (const hz of [110, 196, 261.63, 440, 659.25, 987.77]) {
    const got = detectPitch(sine(hz, 44100, 2048, [1, 0.6, 0.3, 0.2]), 44100);
    assert.ok(Math.abs(1200 * Math.log2(got / hz)) < 10, `${hz} → ${got}`);
  }
  assert.equal(detectPitch(new Float32Array(2048), 44100), null);
});

test('note tracker turns steady pitches into notes', () => {
  const events = [];
  const tr = new NoteTracker({ onStart: (m) => events.push(['on', m]), onEnd: (m) => events.push(['off', m]) });
  const feed = [null, 60.1, 60.2, 59.9, 60, 60.1, 60, 64.2, 64, 63.9, 64.1, 64, null, null, null, null, null];
  feed.forEach((x) => tr.push(x));
  assert.deepEqual(events, [['on', 60], ['off', 60], ['on', 64], ['off', 64]]);
});

const melody = ['C4', 'Eb4', 'G4', 'F4', 'Eb4', 'D4', 'C4', 'D4'].map((s) => ({ midi: parseNoteName(s), beats: 1 }));
const key = parseKey('C minor');

test('continuing a melody stays in key, fills whole bars and ends on the home note', () => {
  for (let seed = 1; seed < 40; seed++) {
    const { melody: more, chords } = continueMelody(melody, key, [], { bars: 2, seed });
    assert.equal(totalBeats(more), 8);
    assert.equal(chords.reduce((s, c) => s + c.beats, 0), 8);
    const pcs = scalePcs(key);
    assert.ok(more.every((e) => pcs.includes(e.midi % 12)), `seed ${seed}`);
    assert.equal(more[more.length - 1].midi % 12, 0);
    assert.equal(chordSymbol(chords[chords.length - 1].chord), 'Cm');
  }
});

test('a variation keeps the length and the last note', () => {
  for (let seed = 1; seed < 20; seed++) {
    const v = varyMelody(melody, key, { seed });
    assert.equal(totalBeats(v), totalBeats(melody));
    assert.equal(v[v.length - 1].midi, melody[melody.length - 1].midi);
  }
});

test('richer chords add sevenths', () => {
  const out = richerChords([{ chord: parseChord('G'), beats: 4 }, { chord: parseChord('Ab'), beats: 4 }, { chord: null, beats: 2 }], key);
  assert.deepEqual(out.map((c) => chordSymbol(c.chord, true)), ['G7', 'Abmaj7', 'N.C.']);
});

test('MIDI export writes a valid header and three tracks', () => {
  const bytes = toMidi({ bpm: 100, melody, chords: [{ chord: parseChord('Cm'), beats: 4 }, { chord: parseChord('G'), beats: 4 }] });
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  let tracks = 0;
  for (let i = 0; i < bytes.length - 3; i++) if (String.fromCharCode(...bytes.slice(i, i + 4)) === 'MTrk') tracks++;
  assert.equal(tracks, 3);
});
