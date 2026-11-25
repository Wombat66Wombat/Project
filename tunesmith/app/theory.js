// Music theory for Tunesmith: note and chord names, keys, key detection,
// harmonising a melody, and "what comes next" chord suggestions.
// Pure functions only, so they run in the app and in Node tests alike.

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const mod12 = (n) => ((n % 12) + 12) % 12;

// ---------- Notes ----------

/** Reads a letter plus accidentals at the start of `s`. Returns { pc, rest } or null. */
export function readPitchClass(s) {
  const m = /^\s*([A-Ga-g])((?:#|b|♯|♭|x)*)(?:\s*-?\s*(sharp|flat))?/.exec(s);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) {
    if (ch === '#' || ch === '♯') pc += 1;
    else if (ch === 'x') pc += 2;
    else pc -= 1;
  }
  if (m[3] === 'sharp') pc += 1;
  if (m[3] === 'flat') pc -= 1;
  return { pc: mod12(pc), rest: s.slice(m[0].length) };
}

export function pcName(pc, flats = false) {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** 60 → "C4" (middle C is C4). */
export function noteName(midi, flats = false) {
  return pcName(midi, flats) + (Math.floor(midi / 12) - 1);
}

/** "Eb4" → 63. Returns null when it isn't a note name. */
export function parseNoteName(s) {
  if (typeof s !== 'string') return null;
  const m = /^\s*([A-Ga-g])(#|b|♯|♭)?(-?\d)\s*$/.exec(s);
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  const midi = (Number(m[3]) + 1) * 12 + pc;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** All notes of a melody event: its main note plus any notes stacked on it (`also`). */
export const notesOf = (e) => (e.midi == null ? [] : [e.midi, ...(e.also || [])]);

export const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (f) => 69 + 12 * Math.log2(f / 440);

// ---------- Chords ----------

export const QUALITIES = {
  maj: { iv: [0, 4, 7], suffix: '', label: 'major' },
  min: { iv: [0, 3, 7], suffix: 'm', label: 'minor' },
  dim: { iv: [0, 3, 6], suffix: 'dim', label: 'diminished' },
  aug: { iv: [0, 4, 8], suffix: 'aug', label: 'augmented' },
  sus2: { iv: [0, 2, 7], suffix: 'sus2', label: 'sus2' },
  sus4: { iv: [0, 5, 7], suffix: 'sus4', label: 'sus4' },
  7: { iv: [0, 4, 7, 10], suffix: '7', label: 'seventh' },
  maj7: { iv: [0, 4, 7, 11], suffix: 'maj7', label: 'major seventh' },
  m7: { iv: [0, 3, 7, 10], suffix: 'm7', label: 'minor seventh' },
  m7b5: { iv: [0, 3, 6, 10], suffix: 'm7b5', label: 'half-diminished' },
  dim7: { iv: [0, 3, 6, 9], suffix: 'dim7', label: 'diminished seventh' },
  6: { iv: [0, 4, 7, 9], suffix: '6', label: 'sixth' },
  m6: { iv: [0, 3, 7, 9], suffix: 'm6', label: 'minor sixth' },
  add9: { iv: [0, 4, 7, 14], suffix: 'add9', label: 'add nine' },
  madd9: { iv: [0, 3, 7, 14], suffix: 'madd9', label: 'minor add nine' },
  9: { iv: [0, 4, 7, 10, 14], suffix: '9', label: 'ninth' },
  maj9: { iv: [0, 4, 7, 11, 14], suffix: 'maj9', label: 'major ninth' },
  m9: { iv: [0, 3, 7, 10, 14], suffix: 'm9', label: 'minor ninth' },
};

const MINORISH = new Set(['min', 'm7', 'm6', 'm9', 'madd9', 'dim', 'm7b5', 'dim7']);
export const isMinorish = (q) => MINORISH.has(q);

// Exact-case spellings first (M7 is major seventh, m7 minor seventh).
const CASED = { M: 'maj', M7: 'maj7', M9: 'maj9', 'Δ': 'maj7', 'Δ7': 'maj7', 'ø': 'm7b5', 'ø7': 'm7b5', '°': 'dim', '°7': 'dim7', '+': 'aug', '-': 'min', '-7': 'm7' };
const LOWER = {
  '': 'maj', maj: 'maj', major: 'maj', dur: 'maj',
  m: 'min', min: 'min', minor: 'min', moll: 'min', mi: 'min',
  dim: 'dim', diminished: 'dim', o: 'dim',
  aug: 'aug', augmented: 'aug',
  sus: 'sus4', sus4: 'sus4', suspended: 'sus4', suspended4: 'sus4', sus2: 'sus2', suspended2: 'sus2',
  7: '7', dom7: '7', dominant7: '7', dominantseventh: '7', seventh: '7', dominant: '7',
  maj7: 'maj7', major7: 'maj7', majorseventh: 'maj7', ma7: 'maj7',
  m7: 'm7', min7: 'm7', minor7: 'm7', minorseventh: 'm7', mi7: 'm7',
  m7b5: 'm7b5', 'min7b5': 'm7b5', halfdiminished: 'm7b5', halfdim: 'm7b5',
  dim7: 'dim7', o7: 'dim7', diminished7: 'dim7', diminishedseventh: 'dim7',
  6: '6', maj6: '6', major6: '6', m6: 'm6', min6: 'm6', minor6: 'm6',
  add9: 'add9', add2: 'add9', madd9: 'madd9', minadd9: 'madd9',
  9: '9', dominant9: '9', maj9: 'maj9', major9: 'maj9', m9: 'm9', min9: 'm9', minor9: 'm9',
};

/** Parses "C minor", "Cm", "c", "Am7", "F# major 7", "Bb", "Eb sus4", "G/B"… → { root, quality } or null. */
export function parseChord(input) {
  if (typeof input !== 'string') return null;
  const head = readPitchClass(input.trim());
  if (!head) return null;
  let rest = head.rest.replace(/\/.*$/, '').replace(/\bchords?\b/gi, '').trim(); // drop slash bass and the word "chord"
  // A bare lowercase letter ("c") means major, as typed by most people.
  const squashed = rest.replace(/[\s.()_]/g, '');
  const quality = CASED[squashed] ?? LOWER[squashed.toLowerCase()];
  if (!quality) return null;
  return { root: head.pc, quality };
}

export const isNoChord = (s) => typeof s === 'string' && /^\s*(n\.?c\.?|no chord|rest|-)\s*$/i.test(s);

export function chordSymbol(chord, flats = false) {
  if (!chord) return 'N.C.';
  return pcName(chord.root, flats) + QUALITIES[chord.quality].suffix;
}

export function chordLabel(chord, flats = false) {
  if (!chord) return 'no chord';
  return `${pcName(chord.root, flats)} ${QUALITIES[chord.quality].label}`;
}

export function chordPcs(chord) {
  return QUALITIES[chord.quality].iv.map((i) => mod12(chord.root + i));
}

export const sameChord = (a, b) => !!a && !!b && a.root === b.root && a.quality === b.quality;

/**
 * Notes to play for a chord: a bass note plus a close voicing near the previous voicing
 * (so changes sound smooth rather than jumping around).
 */
export function voiceChord(chord, prev = null) {
  const iv = QUALITIES[chord.quality].iv.map((i) => (i >= 12 ? i - 12 : i));
  const uniq = [...new Set(iv)].sort((a, b) => a - b);
  const bass = 36 + mod12(chord.root - 0); // C2..B2
  const center = prev && prev.length > 1 ? prev.slice(1).reduce((a, b) => a + b, 0) / (prev.length - 1) : 62;
  let best = null;
  for (let base = 48; base <= 60; base++) {
    if (mod12(base) !== chord.root) continue;
    for (let inv = 0; inv < uniq.length; inv++) {
      const notes = uniq.map((i, k) => base + i + (k < inv ? 12 : 0)).sort((a, b) => a - b);
      if (notes[0] < 52 || notes[notes.length - 1] > 76) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      const cost = Math.abs(mean - center);
      if (!best || cost < best.cost) best = { notes, cost };
    }
  }
  const upper = best ? best.notes : uniq.map((i) => 60 + chord.root + i);
  return [bass, ...upper];
}

// ---------- Keys ----------

export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

export function usesFlats(key) {
  const majorTonic = key.mode === 'major' ? key.tonic : mod12(key.tonic + 3);
  return [5, 10, 3, 8, 1].includes(majorTonic);
}

export function keyName(key) {
  return `${pcName(key.tonic, usesFlats(key))} ${key.mode}`;
}

export function parseKey(s) {
  const c = parseChord(String(s).replace(/\bkey\b/i, ''));
  if (!c) return null;
  return { tonic: c.root, mode: isMinorish(c.quality) ? 'minor' : 'major' };
}

export function scalePcs(key) {
  return SCALES[key.mode].map((i) => mod12(key.tonic + i));
}

export const ALL_KEYS = [];
for (let pc = 0; pc < 12; pc++) ALL_KEYS.push({ tonic: pc, mode: 'major' }, { tonic: pc, mode: 'minor' });

// Krumhansl–Kessler key profiles.
const PROFILE = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};

function correlation(a, b) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/**
 * Guesses the key from melody events ({ midi, beats }) and optional chords ({ chord, beats }).
 * Returns keys ranked best first: [{ key, score }].
 */
export function detectKey(melody, chords = []) {
  const hist = new Array(12).fill(0);
  const notes = melody.filter((e) => e.midi != null);
  for (const e of notes) {
    hist[mod12(e.midi)] += Math.min(e.beats, 2) + 0.25;
    for (const m of e.also || []) hist[mod12(m)] += (Math.min(e.beats, 2) + 0.25) * 0.5;
  }
  for (const c of chords) if (c.chord) for (const pc of chordPcs(c.chord)) hist[pc] += 0.35 * c.beats;
  if (!hist.some((x) => x > 0)) return [];
  // Melodies usually end (and often start) on the home note.
  if (notes.length) {
    hist[mod12(notes[notes.length - 1].midi)] += 1;
    hist[mod12(notes[0].midi)] += 0.5;
  }
  const firstChord = chords.find((c) => c.chord)?.chord;
  return ALL_KEYS.map((key) => {
    const prof = PROFILE[key.mode];
    const rotated = hist.map((_, i) => hist[mod12(i + key.tonic)]);
    let score = correlation(rotated, prof);
    // A progression that starts on a chord is very likely in that chord's key.
    if (firstChord && firstChord.root === key.tonic && isMinorish(firstChord.quality) === (key.mode === 'minor')) score += 0.15;
    return { key, score };
  }).sort((a, b) => b.score - a.score);
}

// ---------- Roman numerals ----------

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// Interval above the tonic → [accidental, degree index], per mode.
const DEGREE_OF = {
  major: { 0: ['', 0], 1: ['b', 1], 2: ['', 1], 3: ['b', 2], 4: ['', 2], 5: ['', 3], 6: ['#', 3], 7: ['', 4], 8: ['b', 5], 9: ['', 5], 10: ['b', 6], 11: ['', 6] },
  minor: { 0: ['', 0], 1: ['b', 1], 2: ['', 1], 3: ['', 2], 4: ['#', 2], 5: ['', 3], 6: ['#', 3], 7: ['', 4], 8: ['', 5], 9: ['#', 5], 10: ['', 6], 11: ['#', 6] },
};
const ROMAN_SUFFIX = { maj: '', min: '', dim: '°', aug: '+', sus2: 'sus2', sus4: 'sus4', 7: '7', maj7: 'maj7', m7: '7', m7b5: 'ø7', dim7: '°7', 6: '6', m6: '6', add9: 'add9', madd9: 'add9', 9: '9', maj9: 'maj9', m9: '9' };

export function romanFor(chord, key) {
  if (!chord) return '';
  const [acc, deg] = DEGREE_OF[key.mode][mod12(chord.root - key.tonic)];
  const numeral = isMinorish(chord.quality) ? ROMAN[deg].toLowerCase() : ROMAN[deg];
  return acc + numeral + ROMAN_SUFFIX[chord.quality];
}

/** "bVII", "ii7", "V7", "vii°", "iiø7", "Imaj7" in a key → chord. */
export function romanToChord(roman, key) {
  const m = /^(b|#)?(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(°7|°|ø7|\+|maj7|maj9|add9|sus2|sus4|7|9|6)?$/.exec(roman);
  if (!m) return null;
  const deg = ROMAN.indexOf(m[2].toUpperCase());
  const lower = m[2] === m[2].toLowerCase();
  let root = key.tonic + SCALES[key.mode][deg] + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0);
  const s = m[3] || '';
  let quality;
  if (s === '°') quality = 'dim';
  else if (s === '°7') quality = 'dim7';
  else if (s === 'ø7') quality = 'm7b5';
  else if (s === '+') quality = 'aug';
  else if (s === '7') quality = lower ? 'm7' : '7';
  else if (s === '9') quality = lower ? 'm9' : '9';
  else if (s === '6') quality = lower ? 'm6' : '6';
  else if (s === 'add9') quality = lower ? 'madd9' : 'add9';
  else if (s) quality = s; // maj7, maj9, sus2, sus4
  else quality = lower ? 'min' : 'maj';
  return { root: mod12(root), quality };
}

// ---------- Chord vocabulary per key ----------

// Chords a song in this key commonly uses, with how common they are (0..1).
const VOCAB = {
  major: [['I', 1], ['IV', 0.9], ['V', 0.9], ['vi', 0.85], ['ii', 0.7], ['iii', 0.45], ['V7', 0.55], ['iv', 0.25], ['bVII', 0.25], ['vii°', 0.15], ['bVI', 0.2]],
  minor: [['i', 1], ['iv', 0.85], ['VI', 0.85], ['VII', 0.8], ['III', 0.75], ['V', 0.6], ['v', 0.5], ['V7', 0.5], ['ii°', 0.25], ['IV', 0.15]],
};

export function keyChords(key) {
  return VOCAB[key.mode].map(([roman, weight]) => ({ roman, weight, chord: romanToChord(roman, key) }));
}

// How natural it feels to move from one chord to the next (rough rules of thumb).
function moveScore(from, to, key) {
  if (!from || !to) return 0;
  if (sameChord(from, to)) return -0.15;
  const motion = mod12(to.root - from.root);
  const toTonic = to.root === key.tonic;
  const fromDominant = mod12(from.root - key.tonic) === 7 && !isMinorish(from.quality);
  let s = 0;
  if (motion === 5) s += 0.55; // down a fifth: the strongest pull (e.g. G → C)
  else if (motion === 2 || motion === 10) s += 0.25; // step
  else if (motion === 8 || motion === 9) s += 0.3; // down a third (C → Am, C → Ab)
  else if (motion === 7) s += 0.2; // up a fifth
  else if (motion === 3 || motion === 4) s += 0.1;
  if (fromDominant && toTonic) s += 0.6; // V → I: "home"
  if (fromDominant && mod12(to.root - key.tonic) === (key.mode === 'major' ? 9 : 8)) s += 0.2; // deceptive V → vi
  return s;
}

/** Plain-language description of what a chord does in a key. */
export function describeChord(chord, key) {
  const r = romanFor(chord, key).replace(/[°ø+]|7|9|6|maj|add|sus\d/g, '');
  const minor = key.mode === 'minor';
  const map = minor
    ? { i: 'home: settled and resolved', iv: 'a sad, gentle step away', VI: 'warm and epic', VII: 'pushes strongly back home', III: 'brighter, a hopeful lift', V: 'big tension that wants to go home', v: 'soft tension, folky and dark', 'ii': 'restless, leads to V', IV: 'a surprising bright colour' }
    : { I: 'home: settled and resolved', IV: 'a lift, open and hopeful', V: 'tension that wants to go home', vi: 'a bittersweet, sadder turn', ii: 'a gentle step that leads to V', iii: 'dreamy, in between', iv: 'borrowed minor: wistful', bVII: 'rock-style, bold', 'vii': 'tense, leans into home', bVI: 'cinematic and dramatic' };
  return map[r] || 'adds colour';
}

/**
 * Chords that could come after `prev` in `key`, best first: [{ chord, roman, why, score }].
 */
export function nextChordSuggestions(prev, key, count = 6) {
  const seen = new Set();
  return keyChords(key)
    .map(({ chord, roman, weight }) => ({ chord, roman, why: describeChord(chord, key), score: weight * 0.8 + moveScore(prev, chord, key) }))
    .filter((s) => !sameChord(s.chord, prev))
    .sort((a, b) => b.score - a.score)
    .filter((s) => {
      const k = chordSymbol(s.chord);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, count);
}

const PROGRESSIONS = {
  major: [
    ['Pop anthem', 'I V vi IV'],
    ['50s ballad', 'I vi IV V'],
    ['Hopeful', 'I IV vi V'],
    ['Folk', 'I IV I V'],
    ['Bittersweet', 'I iii IV iv'],
    ['Jazzy', 'Imaj7 vi7 ii7 V7'],
  ],
  minor: [
    ['Epic', 'i VI III VII'],
    ['Classic minor', 'i iv V i'],
    ['Flamenco', 'i VII VI V'],
    ['Moody', 'i iv VII III'],
    ['Dark pop', 'i VI VII VII'],
    ['Lament', 'i v iv V'],
  ],
};

/** The key a chord most naturally belongs to, preferring `current` when the chord fits it. */
export function keyForChord(chord, current = null) {
  if (current) {
    const triad = { root: chord.root, quality: chord.quality === 'dim' || chord.quality === 'm7b5' ? 'dim' : isMinorish(chord.quality) ? 'min' : 'maj' };
    if (keyChords(current).some((k) => sameChord(k.chord, triad))) return current;
  }
  return { tonic: chord.root, mode: isMinorish(chord.quality) ? 'minor' : 'major' };
}

/** Well-known progressions in `key`, each turned to start on `start` when it contains it. */
export function progressionIdeas(key, start = null) {
  return PROGRESSIONS[key.mode].map(([name, romans]) => {
    let chords = romans.split(' ').map((r) => romanToChord(r, key));
    if (start) {
      const at = chords.findIndex((c) => c.root === start.root && isMinorish(c.quality) === isMinorish(start.quality));
      if (at > 0) chords = [...chords.slice(at), ...chords.slice(0, at)];
      else if (at < 0) chords = [start, ...chords.slice(0, 3)];
      chords[0] = start;
    }
    return { name, chords, romans: chords.map((c) => romanFor(c, key)) };
  });
}

// ---------- Harmonising a melody ----------

/** Melody events → [{ midi, start, beats }] with start times (rests dropped). */
export function timeline(events) {
  const out = [];
  let t = 0;
  for (const e of events) {
    for (const midi of notesOf(e)) out.push({ midi, start: t, beats: e.beats });
    t += e.beats;
  }
  return out;
}

export const totalBeats = (events) => events.reduce((s, e) => s + e.beats, 0);

/**
 * Picks chords for a melody: one chord every `beatsPerChord` beats.
 * Each chord should contain the melody's important notes, and the chords should flow
 * (V → I, IV → V …). Solved with the Viterbi algorithm over the key's chord vocabulary.
 * Returns [{ chord, beats, alternatives: [chord…] }].
 */
export function harmonize(melody, key, { beatsPerChord = 4, startChord = null } = {}) {
  const notes = timeline(melody);
  const total = totalBeats(melody);
  if (!notes.length || total <= 0) return [];
  const segCount = Math.max(1, Math.ceil(total / beatsPerChord - 1e-9));
  const scale = new Set(scalePcs(key));
  const vocab = keyChords(key);
  if (startChord && !vocab.some((v) => sameChord(v.chord, startChord))) vocab.push({ roman: romanFor(startChord, key), weight: 0.6, chord: startChord });

  const emissions = [];
  for (let s = 0; s < segCount; s++) {
    const a = s * beatsPerChord, b = a + beatsPerChord;
    const inSeg = [];
    for (const n of notes) {
      const overlap = Math.min(b, n.start + n.beats) - Math.max(a, n.start);
      if (overlap <= 0) continue;
      const pos = n.start - a;
      // Notes on strong beats and long notes matter most.
      const strong = pos === 0 ? 1.6 : Math.abs(pos - beatsPerChord / 2) < 1e-9 ? 1.25 : Number.isInteger(pos) ? 1 : 0.7;
      inSeg.push({ pc: mod12(n.midi), w: Math.min(overlap, 2) * strong });
    }
    emissions.push(
      vocab.map(({ chord, weight }) => {
        const pcs = chordPcs(chord);
        let e = 0;
        for (const { pc, w } of inSeg) e += pcs.includes(pc) ? w : scale.has(pc) ? -0.35 * w : -1.1 * w;
        if (inSeg.length && pcs.length > 3) e -= 0.15; // keep plain triads unless they help
        return e + Math.log(weight + 0.05);
      }),
    );
  }

  const tonicIdx = vocab.map((v) => v.chord.root === key.tonic && isMinorish(v.chord.quality) === (key.mode === 'minor') && QUALITIES[v.chord.quality].iv.length === 3);
  const isDominant = vocab.map((v) => mod12(v.chord.root - key.tonic) === 7 && !isMinorish(v.chord.quality));
  // Chord changes matter less than fitting the melody; staying on a chord is fine.
  const flow = (a, b) => (sameChord(a, b) ? 0.05 : 0.5 * moveScore(a, b, key));
  const n = vocab.length;
  let score = vocab.map((v, i) => {
    if (startChord) return sameChord(v.chord, startChord) ? emissions[0][i] + 10 : -Infinity;
    return emissions[0][i] + (tonicIdx[i] ? 0.6 : 0);
  });
  const back = [];
  for (let s = 1; s < segCount; s++) {
    const next = new Array(n).fill(-Infinity);
    const ptr = new Array(n).fill(0);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = score[i] + flow(vocab[i].chord, vocab[j].chord);
        if (v > next[j]) { next[j] = v; ptr[j] = i; }
      }
      next[j] += emissions[s][j];
      if (s === segCount - 1) next[j] += tonicIdx[j] ? 1 : isDominant[j] ? 0.15 : 0;
    }
    back.push(ptr);
    score = next;
  }
  let best = score.indexOf(Math.max(...score));
  const path = [best];
  for (let s = back.length - 1; s >= 0; s--) {
    best = back[s][best];
    path.unshift(best);
  }

  return path.map((idx, s) => {
    const beats = s === segCount - 1 ? total - s * beatsPerChord : beatsPerChord;
    const alternatives = emissions[s]
      .map((e, i) => ({ i, e: e + (s > 0 ? flow(vocab[path[s - 1]].chord, vocab[i].chord) : 0) }))
      .filter((x) => x.i !== idx)
      .sort((a, b) => b.e - a.e)
      .slice(0, 4)
      .map((x) => vocab[x.i].chord);
    return { chord: vocab[idx].chord, beats, alternatives };
  });
}

/** Turns plain triads into richer chords (sevenths, ninths, sus) in a key. */
export function enrichChord(chord, key) {
  const r = romanFor(chord, key);
  if (QUALITIES[chord.quality].iv.length > 3) return chord;
  const deg = mod12(chord.root - key.tonic);
  if (chord.quality === 'maj' && deg === 7) return { ...chord, quality: '7' };
  if (chord.quality === 'maj' && (r === 'I' || r === 'IV' || r === 'III' || r === 'VI')) return { ...chord, quality: 'maj7' };
  if (chord.quality === 'min') return { ...chord, quality: r === 'i' ? 'madd9' : 'm7' };
  if (chord.quality === 'dim') return { ...chord, quality: 'm7b5' };
  if (chord.quality === 'maj') return { ...chord, quality: 'add9' };
  return chord;
}
