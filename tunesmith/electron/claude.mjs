// Asks Claude for musical ideas and gets them back as structured notes and chords.

import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

const SYSTEM = `You are a friendly songwriting partner inside Tunesmith, a desktop app for people who find melodies by ear. Most users don't know music theory, so they rely on you to suggest chords and to develop their ideas.

You receive the user's song so far (key, tempo, instrument, melody and chords) and a task. Reply with music in the required JSON format:
- melody: a list of notes. Each has "note" in scientific pitch notation (middle C is "C4"; use "Eb4" style flats or "F#4" style sharps to match the key) or "rest", and "beats" (quarter note = 1; use multiples of 0.25).
- chords: a list of chords, each held for "beats". Write chord symbols from this set only: C, Cm, Cdim, Caug, Csus2, Csus4, C7, Cmaj7, Cm7, Cm7b5, Cdim7, C6, Cm6, Cadd9, Cmadd9, C9, Cmaj9, Cm9 (any root, e.g. "Ab", "F#m7", "Bbsus4"), or "N.C." for no chord.
- apply: "append" when your music should be added after the end of the song, "replace" when it should replace the song's melody and/or chords. With "replace", an empty melody list keeps the user's melody and an empty chord list keeps their chords.
- key: the key your suggestion is in, e.g. "C minor".
- explanation: one to three short, warm sentences in plain words: what you did and why it works. Name the chords you used. Avoid jargon, or explain it in a few words.

Write in 4/4. When appending, the new melody and the new chords must each add up to the same whole number of bars (multiples of 4 beats). Keep melodies singable: mostly steps and small leaps, within about an octave and a half, in a register close to the user's. Respect the user's style and keep what they made recognisable.`;

const SCHEMA = {
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

const TASKS = {
  continue: 'Continue the song: write the next bars (melody and chords) so they follow naturally from what is there, as if it were the next phrase. Use apply "append".',
  variation: 'Write a variation of the whole melody: same feel and length, recognisably the same tune, but more interesting. Return the full new melody, an empty chord list, and apply "replace".',
  chords: 'Suggest chords for the existing melody, better or more colourful than the current ones (or new ones if there are none). Return the full chord list covering the whole melody, an empty melody list, and apply "replace".',
  free: 'Do what the user asks below. Choose "append" or "replace" to fit the request.',
};

function describeSong(song) {
  const lines = [
    `Key: ${song.key || 'unknown'}`,
    `Tempo: ${song.bpm} BPM, 4/4`,
    `Melody instrument: ${song.melodyInstrument}; chord instrument: ${song.chordInstrument}`,
    `Melody (${song.melody.length} notes): ${song.melody.length ? song.melody.map((n) => `${n.note}:${n.beats}`).join(' ') : '(empty)'}`,
    `Chords: ${song.chords.length ? song.chords.map((c) => `${c.chord}:${c.beats}`).join(' ') : '(none yet)'}`,
  ];
  return lines.join('\n');
}

/** payload: { task: 'continue'|'variation'|'chords'|'free', request: string, bars: number, song } */
export async function askClaude(apiKey, payload) {
  const client = new Anthropic({ apiKey, timeout: 120_000 });
  const task = TASKS[payload.task] ? payload.task : 'free';
  const request = String(payload.request || '').slice(0, 2000);
  const text = [
    '<song>',
    describeSong(payload.song),
    '</song>',
    `Task: ${TASKS[task]}`,
    task === 'continue' ? `Length: ${payload.bars || 4} bars.` : '',
    request ? `The user says: ${request}` : 'The user gave no extra instructions.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    if (response.stop_reason === 'refusal') {
      return { ok: false, error: response.stop_details?.explanation || 'Claude declined this request. Try wording it differently.' };
    }
    if (response.stop_reason === 'max_tokens') return { ok: false, error: 'The answer was too long. Ask for fewer bars.' };
    const block = response.content.find((b) => b.type === 'text');
    if (!block) return { ok: false, error: 'Claude sent no music back. Please try again.' };
    return { ok: true, data: JSON.parse(block.text), model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, needsKey: true, error: 'Claude rejected the API key. Check it in Settings.' };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, error: 'This API key is not allowed to use the model. Check your Claude Console account.' };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Too many requests right now. Wait a moment and try again.' };
    if (error instanceof Anthropic.BadRequestError) return { ok: false, error: `Claude couldn't read the request: ${error.message}` };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: "Can't reach Claude. Check your internet connection." };
    if (error instanceof Anthropic.APIError) return { ok: false, error: `Claude had a problem (${error.status ?? 'error'}). Try again in a moment.` };
    if (error instanceof SyntaxError) return { ok: false, error: 'Claude sent an answer the app could not read. Please try again.' };
    return { ok: false, error: String(error?.message || error) };
  }
}
