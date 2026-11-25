import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChord, chordSymbol, chordLabel, parseNoteName, noteName, detectKey, keyName, harmonize,
  nextChordSuggestions, progressionIdeas, romanFor, romanToChord, keyForChord, voiceChord, parseKey,
} from '../app/theory.js';

const N = (s, beats = 1) => ({ midi: parseNoteName(s), beats });
const sym = (c, flats = true) => chordSymbol(c, flats);

test('parses chords the way people type them', () => {
  const cases = {
    'C minor': 'Cm', Cm: 'Cm', c: 'C', 'c minor': 'Cm', 'C min': 'Cm', 'C-': 'Cm', 'Am7': 'Am7', 'F# major 7': 'Gbmaj7',
    Bb: 'Bb', 'bb minor': 'Bbm', 'Eb sus4': 'Ebsus4', 'G7': 'G7', 'G/B': 'G', 'C M7': 'Cmaj7', 'Cmaj7': 'Cmaj7',
    'D dim': 'Ddim', 'Bø7': 'Bm7b5', 'F sharp minor': 'Gbm', 'A minor chord': 'Am', 'E flat major': 'Eb', 'C add9': 'Cadd9',
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(sym(parseChord(input)), want, input);
  assert.equal(parseChord('hello'), null);
  assert.equal(parseChord('C blorp'), null);
  assert.equal(chordLabel(parseChord('C minor'), true), 'C minor');
});

test('note names round-trip', () => {
  assert.equal(parseNoteName('C4'), 60);
  assert.equal(parseNoteName('Eb4'), 63);
  assert.equal(parseNoteName('F#3'), 54);
  assert.equal(noteName(63, true), 'Eb4');
  assert.equal(parseNoteName('rest'), null);
});

test('detects C minor and G major melodies', () => {
  const cMinor = ['C4', 'Eb4', 'G4', 'F4', 'Eb4', 'D4', 'C4', 'G3', 'Ab3', 'Bb3', 'C4'].map((n) => N(n));
  assert.equal(keyName(detectKey(cMinor)[0].key), 'C minor');
  const gMajor = ['G4', 'B4', 'D5', 'C5', 'B4', 'A4', 'F#4', 'G4'].map((n) => N(n));
  assert.equal(keyName(detectKey(gMajor)[0].key), 'G major');
  assert.deepEqual(detectKey([]), []);
});

test('roman numerals', () => {
  const cm = parseKey('C minor');
  assert.equal(romanFor(parseChord('Ab'), cm), 'VI');
  assert.equal(romanFor(parseChord('G7'), cm), 'V7');
  assert.equal(romanFor(parseChord('Fm'), cm), 'iv');
  assert.equal(sym(romanToChord('bVII', parseKey('C'))), 'Bb');
  assert.equal(sym(romanToChord('ii7', parseKey('C'))), 'Dm7');
  assert.equal(sym(romanToChord('vii°', parseKey('C'))), 'Bdim');
});

test('harmonises Twinkle Twinkle with I IV I V I-ish chords', () => {
  const twinkle = ['C4', 'C4', 'G4', 'G4', 'A4', 'A4', 'G4:2', 'F4', 'F4', 'E4', 'E4', 'D4', 'D4', 'C4:2'].map((s) => {
    const [n, b] = s.split(':');
    return N(n, Number(b || 1));
  });
  const key = detectKey(twinkle)[0].key;
  assert.equal(keyName(key), 'C major');
  const chords = harmonize(twinkle, key, { beatsPerChord: 2 });
  assert.equal(chords.length, 8);
  assert.deepEqual(chords.map((c) => sym(c.chord)), ['C', 'C', 'F', 'C', 'F', 'C', 'G', 'C']);
  assert.ok(chords.every((c) => c.alternatives.length > 0));
});

test('harmonise honours a starting chord', () => {
  const mel = ['C4', 'Eb4', 'G4', 'Ab4', 'G4', 'F4', 'Eb4', 'D4'].map((n) => N(n));
  const chords = harmonize(mel, parseKey('C minor'), { beatsPerChord: 4, startChord: parseChord('Ab') });
  assert.equal(sym(chords[0].chord), 'Ab');
});

test('suggests what comes after C minor', () => {
  const cm = parseChord('C minor');
  const key = keyForChord(cm);
  assert.equal(keyName(key), 'C minor');
  const next = nextChordSuggestions(cm, key).map((s) => sym(s.chord));
  assert.ok(next.includes('Ab') && next.includes('Fm') && next.includes('Bb'), next.join(' '));
  assert.ok(!next.includes('Cm'));
  const ideas = progressionIdeas(key, cm);
  assert.ok(ideas.length >= 4);
  assert.ok(ideas.every((p) => sym(p.chords[0]) === 'Cm'));
  assert.deepEqual(ideas[0].chords.map((c) => sym(c)), ['Cm', 'Ab', 'Eb', 'Bb']);
});

test('a chord that belongs to the current key keeps that key', () => {
  assert.equal(keyName(keyForChord(parseChord('Am'), parseKey('C major'))), 'C major');
  assert.equal(keyName(keyForChord(parseChord('F#'), parseKey('C major'))), 'F# major');
});

test('progression ideas rotate to start on a chosen chord', () => {
  const ideas = progressionIdeas(parseKey('C major'), parseChord('Am'));
  assert.deepEqual(ideas[0].chords.map((c) => sym(c)), ['Am', 'F', 'C', 'G']);
});

test('voicings stay in a playable range and move smoothly', () => {
  const c = voiceChord(parseChord('C'));
  const f = voiceChord(parseChord('F'), c);
  for (const v of [c, f]) {
    assert.ok(v[0] >= 36 && v[0] < 48);
    assert.ok(v.slice(1).every((n) => n >= 52 && n <= 76));
  }
  const mean = (v) => v.slice(1).reduce((a, b) => a + b) / (v.length - 1);
  assert.ok(Math.abs(mean(c) - mean(f)) < 4);
});

test('stacked notes count as notes sounding together', async () => {
  const { notesOf, timeline } = await import('../app/theory.js');
  const ev = { midi: 60, also: [64, 67], beats: 2 };
  assert.deepEqual(notesOf(ev), [60, 64, 67]);
  assert.deepEqual(notesOf({ midi: null, beats: 1 }), []);
  const tl = timeline([{ midi: 62, beats: 1 }, ev]);
  assert.deepEqual(tl.map((n) => [n.midi, n.start]), [[62, 0], [60, 1], [64, 1], [67, 1]]);
});
