// Built-in idea engine (works offline, no account): continues a melody in its own style,
// makes variations, and enriches chords. Claude gives richer ideas when connected.

import { chordPcs, harmonize, enrichChord, mod12, nextChordSuggestions, scalePcs, timeline, totalBeats, sameChord } from './theory.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function weighted(r, items) {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) <= 0) return v;
  return items[items.length - 1][0];
}

/** All MIDI notes of the key's scale between lo and hi. */
function scaleNotes(key, lo, hi) {
  const pcs = new Set(scalePcs(key));
  const out = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(mod12(m))) out.push(m);
  return out;
}

/** Splits melody events into bars of 4 beats; returns the rhythm (list of beat lengths) of each full bar. */
function barRhythms(melody, beatsPerBar = 4) {
  const bars = [];
  let cur = [];
  let t = 0;
  for (const e of melody) {
    cur.push(e.beats);
    t += e.beats;
    if (Math.abs(t - beatsPerBar) < 1e-9) {
      bars.push(cur);
      cur = [];
      t = 0;
    } else if (t > beatsPerBar) {
      cur = [];
      t = 0;
    }
  }
  return bars.filter((b) => b.length >= 2);
}

const STOCK_RHYTHMS = [[1, 1, 1, 1], [1, 0.5, 0.5, 1, 1], [1.5, 0.5, 2], [0.5, 0.5, 1, 2], [1, 1, 2], [2, 1, 1], [0.5, 0.5, 0.5, 0.5, 1, 1]];

/** The chord sounding at beat `t` of a chord list. */
function chordAt(chords, t) {
  let at = 0;
  for (const c of chords) {
    if (t < at + c.beats - 1e-9) return c.chord;
    at += c.beats;
  }
  return null;
}

/**
 * Continues the melody for `bars` bars, reusing its own rhythms and step sizes
 * (so it sounds like the same song) and landing on chord notes on strong beats.
 * Returns { melody: [...new events], chords: [...new chords] }.
 */
export function continueMelody(melody, key, chords, { bars = 2, seed = Date.now(), beatsPerChord = 4 } = {}) {
  const r = rng(seed);
  const notes = melody.filter((e) => e.midi != null);
  const lo = notes.length ? Math.min(...notes.map((e) => e.midi)) - 2 : 60;
  const hi = notes.length ? Math.max(...notes.map((e) => e.midi)) + 3 : 76;
  const range = scaleNotes(key, Math.min(lo, 57), Math.max(hi, 72));
  const idx = (m) => {
    let best = 0;
    range.forEach((n, i) => {
      if (Math.abs(n - m) < Math.abs(range[best] - m)) best = i;
    });
    return best;
  };

  // How this melody tends to move, in scale steps.
  const moves = new Map();
  for (let i = 1; i < notes.length; i++) {
    const s = idx(notes[i].midi) - idx(notes[i - 1].midi);
    if (Math.abs(s) <= 5) moves.set(s, (moves.get(s) || 0) + 1);
  }
  const moveList = moves.size >= 3 ? [...moves.entries()].map(([s, w]) => [s, w + 0.3]) : [[-1, 3], [1, 3], [0, 1], [-2, 1.5], [2, 1.5], [3, 0.6], [-3, 0.6], [4, 0.3]];

  // Chords for the new bars: keep the song's progression going, or suggest one.
  const newChords = [];
  const chordsPerBar = 4 / beatsPerChord;
  const real = chords.filter((c) => c.chord);
  for (let i = 0; i < bars * chordsPerBar; i++) {
    let chord;
    if (real.length >= 2 && r() < 0.65) chord = real[(i + real.length) % real.length].chord;
    else {
      const prev = newChords.length ? newChords[newChords.length - 1].chord : real.length ? real[real.length - 1].chord : null;
      const sugg = nextChordSuggestions(prev, key, 4);
      chord = weighted(r, sugg.map((s, k) => [s.chord, 4 - k]));
    }
    newChords.push({ chord, beats: beatsPerChord });
  }
  // End on home.
  const last = newChords[newChords.length - 1];
  last.chord = { root: key.tonic, quality: key.mode === 'minor' ? 'min' : 'maj' };
  if (newChords.length > 1 && sameChord(newChords[newChords.length - 2].chord, last.chord)) newChords[newChords.length - 2].chord = { root: mod12(key.tonic + 7), quality: 'maj' };

  const rhythms = barRhythms(melody);
  const out = [];
  let cur = notes.length ? idx(notes[notes.length - 1].midi) : idx(60 + key.tonic);
  let t = 0;
  for (let b = 0; b < bars; b++) {
    const rhythm = rhythms.length && r() < 0.75 ? pick(r, rhythms) : pick(r, STOCK_RHYTHMS);
    rhythm.forEach((beats, k) => {
      const finalNote = b === bars - 1 && k === rhythm.length - 1;
      let next = cur + weighted(r, moveList);
      next = Math.max(0, Math.min(range.length - 1, next));
      const chord = chordAt(newChords, t);
      const strong = Number.isInteger(t) && t % 2 === 0;
      if (finalNote) {
        // Land on the home note nearest to where we are.
        const homes = range.map((m, i) => [m, i]).filter(([m]) => mod12(m) === key.tonic);
        next = homes.reduce((best, [, i]) => (Math.abs(i - cur) < Math.abs(best - cur) ? i : best), homes[0][1]);
      } else if (strong && chord) {
        const pcs = chordPcs(chord);
        if (!pcs.includes(mod12(range[next]))) {
          const up = next + 1 < range.length && pcs.includes(mod12(range[next + 1])) ? next + 1 : null;
          const down = next > 0 && pcs.includes(mod12(range[next - 1])) ? next - 1 : null;
          next = up != null && (down == null || r() < 0.5) ? up : down ?? next;
        }
      }
      out.push({ midi: range[next], beats });
      cur = next;
      t += beats;
    });
  }
  return { melody: out, chords: newChords };
}

/**
 * A variation of the whole melody: same shape and ending, with passing notes,
 * neighbour notes and small rhythm changes.
 */
export function varyMelody(melody, key, { seed = Date.now() } = {}) {
  const r = rng(seed);
  const range = scaleNotes(key, 36, 96);
  const out = [];
  for (let i = 0; i < melody.length; i++) {
    const e = melody[i];
    const next = melody.slice(i + 1).find((x) => x.midi != null);
    const lastNote = i === melody.length - 1 || !melody.slice(i + 1).some((x) => x.midi != null);
    if (e.midi == null || lastNote) {
      out.push({ ...e });
      continue;
    }
    const pos = range.indexOf(e.midi);
    const roll = r();
    if (e.beats >= 1 && next && Math.abs(next.midi - e.midi) >= 3 && Math.abs(next.midi - e.midi) <= 5 && pos >= 0 && roll < 0.6) {
      // Fill a leap with a passing note.
      const dir = Math.sign(next.midi - e.midi);
      out.push({ midi: e.midi, beats: e.beats / 2 }, { midi: range[pos + dir] ?? e.midi, beats: e.beats / 2 });
    } else if (e.beats >= 1 && pos >= 0 && roll < 0.45) {
      // Neighbour note: step away and come back.
      const dir = r() < 0.5 ? 1 : -1;
      const half = e.beats / 2;
      out.push({ midi: e.midi, beats: half }, { midi: range[pos + dir] ?? e.midi, beats: half / 2 }, { midi: e.midi, beats: half / 2 });
    } else if (e.beats === 1 && roll < 0.6) {
      // Dotted rhythm.
      out.push({ midi: e.midi, beats: 0.75 }, { midi: next && Math.abs(next.midi - e.midi) <= 2 ? next.midi : e.midi, beats: 0.25 });
    } else out.push({ ...e });
  }
  return out;
}

/** Richer chords: sevenths and colours, plus a suspended chord before a final dominant. */
export function richerChords(chords, key) {
  return chords.map((c) => (c.chord ? { ...c, chord: enrichChord(c.chord, key), alternatives: undefined } : { ...c }));
}

/** Fresh chords for the melody, different from the current ones where a good alternative exists. */
export function reharmonize(melody, key, chords, beatsPerChord = 4) {
  const base = harmonize(melody, key, { beatsPerChord });
  return base.map((c, i) => {
    const cur = chords[i]?.chord;
    if (cur && sameChord(cur, c.chord) && c.alternatives.length) return { chord: c.alternatives[0], beats: c.beats, alternatives: [c.chord, ...c.alternatives.slice(1)] };
    return c;
  });
}

export { totalBeats, timeline };
