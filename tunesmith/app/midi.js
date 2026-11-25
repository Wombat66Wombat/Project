// Standard MIDI file export, so a sketch can be opened in GarageBand, Logic, FL Studio,
// MuseScore, Ableton and so on.

import { voiceChord, notesOf } from './theory.js';

const PPQ = 480;

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function track(events) {
  // events: [{ tick, data: [...] }] → MTrk chunk bytes
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

const text = (s) => [...new TextEncoder().encode(s)];

/** song: { bpm, melody, chords, melodyProgram, chordProgram } → Uint8Array (.mid file). */
export function toMidi({ bpm, melody, chords, melodyProgram = 0, chordProgram = 0 }) {
  const usPerBeat = Math.round(60000000 / bpm);
  const conductor = track([
    { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(text('Tunesmith').length), ...text('Tunesmith')] },
    { tick: 0, order: 1, data: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255] },
    { tick: 0, order: 2, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
  ]);

  const mel = [
    { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(6), ...text('Melody')] },
    { tick: 0, order: 1, data: [0xc0, melodyProgram] },
  ];
  let t = 0;
  for (const e of melody) {
    const len = Math.round(e.beats * PPQ);
    for (const m of notesOf(e)) {
      mel.push({ tick: t, order: 3, data: [0x90, m, 96] });
      mel.push({ tick: t + Math.max(1, len - 10), order: 2, data: [0x80, m, 0] });
    }
    t += len;
  }

  const ch = [
    { tick: 0, order: 0, data: [0xff, 0x03, ...vlq(6), ...text('Chords')] },
    { tick: 0, order: 1, data: [0xc1, chordProgram] },
  ];
  t = 0;
  let prev = null;
  for (const c of chords) {
    const len = Math.round(c.beats * PPQ);
    if (c.chord) {
      const notes = voiceChord(c.chord, prev);
      prev = notes;
      for (const n of notes) {
        ch.push({ tick: t, order: 3, data: [0x91, n, 70] });
        ch.push({ tick: t + Math.max(1, len - 10), order: 2, data: [0x81, n, 0] });
      }
    }
    t += len;
  }

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255];
  return new Uint8Array([...header, ...conductor, ...track(mel), ...track(ch)]);
}
