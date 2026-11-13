import type { Note } from '../types';
import { DIMS, type ModelInfo } from './models';
import { notePassages, plainText } from '../research/passages';

/** Stored embeddings for one note: one vector per chunk, flattened. */
export interface NoteVectors {
  /** Hash of the text the vectors were computed from; recompute when it changes. */
  h: string;
  /** chunks × DIMS floats, each chunk vector L2-normalised. */
  v: Float32Array;
}

export type VectorStore = Map<string, NoteVectors>;

/** FNV-1a: a fast, stable fingerprint of a note's text. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

/** Bump when chunking changes, so stored vectors are recomputed. */
const CHUNKING_VERSION = 'v3';
export const noteHash = (n: Note) => hashText(`${CHUNKING_VERSION}\n${n.title}\n${n.body}`);

export { plainText };

/**
 * The text embedded for each passage of a note, one vector per entry, in this order.
 * The title goes with the first passage only: it describes the note as a whole, and on every
 * passage it would make short, off-topic ones (a funding note, a footer) look relevant just
 * because the document's title is. Empty notes are just the title.
 */
export function chunkNote(n: Note): string[] {
  const title = n.title.trim() || 'Untitled';
  const ps = notePassages(n);
  if (ps.length === 0) return [title];
  return ps.map((p, i) => (i === 0 ? `${title}${p.section ? ` (${p.section})` : ''}: ${p.text}` : `${p.section ? `${p.section}: ` : ''}${p.text}`));
}

function dot(a: Float32Array, ai: number, b: Float32Array, bi: number): number {
  let s = 0;
  for (let k = 0; k < DIMS; k++) s += a[ai + k] * b[bi + k];
  return s;
}

/** Best similarity between a query vector and any chunk of a note, and which chunk it was. */
function bestChunk(q: Float32Array, nv: NoteVectors): { score: number; chunk: number } {
  let score = -1;
  let chunk = 0;
  for (let c = 0; c * DIMS < nv.v.length; c++) {
    const s = dot(q, 0, nv.v, c * DIMS);
    if (s > score) {
      score = s;
      chunk = c;
    }
  }
  return { score, chunk };
}

export interface SemanticHit {
  id: string;
  score: number;
  chunk: number;
}

/** Notes whose meaning matches the query, best first, keeping only real matches (see ModelInfo.minLift). */
export function semanticSearch(q: Float32Array, store: VectorStore, model: ModelInfo, limit = 20): SemanticHit[] {
  const all: SemanticHit[] = [];
  for (const [id, nv] of store) all.push({ id, ...bestChunk(q, nv) });
  if (all.length === 0) return [];
  const mean = all.reduce((s, h) => s + h.score, 0) / all.length;
  const top = Math.max(...all.map((h) => h.score));
  // With very few notes the mean says little, so only the absolute bar applies.
  const lift = all.length >= 4 ? model.minLift : -Infinity;
  return all
    .filter((h) => h.score >= model.minScore && h.score - mean >= lift && top - h.score <= model.maxGap)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export interface PassageHit {
  id: string;
  chunk: number;
  score: number;
}

/** The best individual passages for a question, across all notes (for Ask). */
export function topPassages(q: Float32Array, store: VectorStore, model: ModelInfo, limit = 8): PassageHit[] {
  const all: PassageHit[] = [];
  for (const [id, nv] of store) {
    for (let c = 0; c * DIMS < nv.v.length; c++) all.push({ id, chunk: c, score: dot(q, 0, nv.v, c * DIMS) });
  }
  if (all.length === 0) return [];
  const mean = all.reduce((s, h) => s + h.score, 0) / all.length;
  const top = Math.max(...all.map((h) => h.score));
  const lift = all.length >= 4 ? model.minLift : -Infinity;
  return all
    .filter((h) => h.score >= model.minScore && h.score - mean >= lift && top - h.score <= model.maxGap)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** One normalised vector per note (the mean of its chunks), for note-to-note similarity. */
export function noteVector(nv: NoteVectors): Float32Array {
  const out = new Float32Array(DIMS);
  const n = nv.v.length / DIMS;
  for (let c = 0; c < n; c++) for (let k = 0; k < DIMS; k++) out[k] += nv.v[c * DIMS + k];
  let len = 0;
  for (let k = 0; k < DIMS; k++) len += out[k] * out[k];
  len = Math.sqrt(len) || 1;
  for (let k = 0; k < DIMS; k++) out[k] /= len;
  return out;
}

/** Notes most similar in meaning to `id`, excluding `exclude` (e.g. notes already linked). */
export function relatedNotes(
  id: string,
  store: VectorStore,
  model: ModelInfo,
  exclude: Set<string>,
  limit = 5,
): SemanticHit[] {
  const self = store.get(id);
  if (!self || store.size < 3) return [];
  const sv = noteVector(self);
  const all: SemanticHit[] = [];
  for (const [other, nv] of store) {
    if (other === id) continue;
    all.push({ id: other, score: dot(sv, 0, noteVector(nv), 0), chunk: 0 });
  }
  const mean = all.reduce((s, h) => s + h.score, 0) / all.length;
  const lift = all.length >= 4 ? model.relMinLift : -Infinity;
  return all
    .filter((h) => !exclude.has(h.id) && h.score >= model.relMinScore && h.score - mean >= lift)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Merge keyword and meaning results with reciprocal rank fusion: notes found both ways
 * rise to the top, and each list keeps its own best results near the top.
 */
export function fuse<T extends { id: string }>(keyword: T[], semantic: SemanticHit[], k = 60) {
  const score = new Map<string, number>();
  keyword.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + i)));
  semantic.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + i)));
  const kw = new Set(keyword.map((h) => h.id));
  const sem = new Map(semantic.map((h) => [h.id, h]));
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => ({ id, byText: kw.has(id), byMeaning: sem.get(id) ?? null }));
}
