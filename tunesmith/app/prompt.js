// What Tunesmith tells Claude, shared by the desktop app and the web version.

export const SYSTEM = `You are a friendly songwriting partner inside Tunesmith, a desktop app for people who find melodies by ear. Most users don't know music theory, so they rely on you to suggest chords and to develop their ideas.

You receive the user's song so far (key, tempo, instrument, melody and chords) and a task. Reply with music in the required JSON format:
- melody: a list of notes. Each has "note" in scientific pitch notation (middle C is "C4"; use "Eb4" style flats or "F#4" style sharps to match the key) or "rest", and "beats" (quarter note = 1; use multiples of 0.25).
- chords: a list of chords, each held for "beats". Write chord symbols from this set only: C, Cm, Cdim, Caug, Csus2, Csus4, C7, Cmaj7, Cm7, Cm7b5, Cdim7, C6, Cm6, Cadd9, Cmadd9, C9, Cmaj9, Cm9 (any root, e.g. "Ab", "F#m7", "Bbsus4"), or "N.C." for no chord.
- apply: "append" when your music should be added after the end of the song, "replace" when it should replace the song's melody and/or chords. With "replace", an empty melody list keeps the user's melody and an empty chord list keeps their chords.
- key: the key your suggestion is in, e.g. "C minor".
- explanation: one to three short, warm sentences in plain words: what you did and why it works. Name the chords you used. Avoid jargon, or explain it in a few words.

Write in 4/4. When appending, the new melody and the new chords must each add up to the same whole number of bars (multiples of 4 beats). Keep melodies singable: mostly steps and small leaps, within about an octave and a half, in a register close to the user's. Respect the user's style and keep what they made recognisable.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['explanation', 'apply', 'key', 'melody', 'chords'],
  properties: {
    explanation: { type: 'string' },
    apply: { type: 'string', enum: ['append', 'replace'] },
    key: { type: 'string' },
    melody: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['note', 'beats'],
        properties: { note: { type: 'string' }, beats: { type: 'number' } },
      },
    },
    chords: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chord', 'beats'],
        properties: { chord: { type: 'string' }, beats: { type: 'number' } },
      },
    },
  },
};

export const TASKS = {
  continue: 'Continue the song: write the next bars (melody and chords) so they follow naturally from what is there, as if it were the next phrase. Use apply "append".',
  variation: 'Write a variation of the whole melody: same feel and length, recognisably the same tune, but more interesting. Return the full new melody, an empty chord list, and apply "replace".',
  chords: 'Suggest chords for the existing melody, better or more colourful than the current ones (or new ones if there are none). Return the full chord list covering the whole melody, an empty melody list, and apply "replace".',
  free: 'Do what the user asks below. Choose "append" or "replace" to fit the request.',
};

export function describeSong(song) {
  const lines = [
    `Key: ${song.key || 'unknown'}`,
    `Tempo: ${song.bpm} BPM, 4/4`,
    `Melody instrument: ${song.melodyInstrument}; chord instrument: ${song.chordInstrument}`,
    `Melody (${song.melody.length} notes): ${song.melody.length ? song.melody.map((n) => `${n.note}:${n.beats}`).join(' ') : '(empty)'}`,
    `Chords: ${song.chords.length ? song.chords.map((c) => `${c.chord}:${c.beats}`).join(' ') : '(none yet)'}`,
  ];
  return lines.join('\n');
}

/** The request text for one idea: the song, the task and the user's words. */
export function buildRequest(payload) {
  const task = TASKS[payload.task] ? payload.task : 'free';
  const request = String(payload.request || '').slice(0, 2000);
  return [
    '<song>',
    describeSong(payload.song),
    '</song>',
    `Task: ${TASKS[task]}`,
    task === 'continue' ? `Length: ${payload.bars || 4} bars.` : '',
    request ? `The user says: ${request}` : 'The user gave no extra instructions.',
  ]
    .filter(Boolean)
    .join('\n');
}
