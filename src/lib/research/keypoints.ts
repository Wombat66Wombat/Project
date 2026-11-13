import type { Note } from '../types';
import { noteParagraphs } from './passages';

export interface KeySentence {
  text: string;
  section: string;
  score: number;
}

const STOP = new Set(
  `a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its
  just more most my no not of on or our she so some such than that the their them then there these they this to too
  very was we were what when where which who why will with would you your also about after all any because before
  between both each few other over same through under up while der die das und ist nicht ein eine zu mit von den
  auf für im dem des sich es auch als wie le la les et est une des du en que qui pour dans`.split(/\s+/),
);

const words = (s: string) =>
  s
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];

/** Split text into sentences, keeping ones long enough to say something. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?。]+[.!?。]+["”’)]*|[^.!?。]+$/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 6 && s.length <= 400);
}

/**
 * The sentences that best represent a text (TextRank): sentences are scored by how much
 * they share with other well-connected sentences. No AI or network needed.
 * Returned in reading order.
 */
export function keySentences(note: Note, count = 5): KeySentence[] {
  const all: { text: string; section: string; w: Map<string, number> }[] = [];
  for (const p of noteParagraphs(note)) {
    for (const s of sentences(p.text)) {
      const tf = new Map<string, number>();
      for (const w of words(s)) tf.set(w, (tf.get(w) ?? 0) + 1);
      if (tf.size >= 3) all.push({ text: s, section: p.section, w: tf });
      if (all.length >= 400) break;
    }
  }
  const n = all.length;
  if (n === 0) return [];
  if (n <= count) return all.map((s) => ({ text: s.text, section: s.section, score: 1 }));
  // IDF-weighted cosine similarity between sentences.
  const df = new Map<string, number>();
  for (const s of all) for (const w of s.w.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const vecs = all.map((s) => {
    const v = new Map<string, number>();
    let len = 0;
    for (const [w, c] of s.w) {
      const x = c * Math.log(1 + n / (df.get(w) ?? 1));
      v.set(w, x);
      len += x * x;
    }
    return { v, len: Math.sqrt(len) || 1 };
  });
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let d = 0;
      const [a, b] = vecs[i].v.size < vecs[j].v.size ? [vecs[i], vecs[j]] : [vecs[j], vecs[i]];
      for (const [w, x] of a.v) {
        const y = b.v.get(w);
        if (y) d += x * y;
      }
      sim[i][j] = sim[j][i] = d / (vecs[i].len * vecs[j].len);
    }
  }
  const out = sim.map((row) => row.reduce((s, x) => s + x, 0) || 1);
  let rank = new Array(n).fill(1 / n);
  for (let it = 0; it < 30; it++) {
    rank = rank.map((_, i) => {
      let s = 0;
      for (let j = 0; j < n; j++) if (sim[j][i]) s += (sim[j][i] / out[j]) * rank[j];
      return 0.15 / n + 0.85 * s;
    });
  }
  return rank
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .sort((a, b) => a.i - b.i)
    .map(({ i, score }) => ({ text: all[i].text, section: all[i].section, score }));
}
