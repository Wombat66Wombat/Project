import { describe, expect, it } from 'vitest';
import { chunkNote, fuse, hashText, noteVector, plainText, relatedNotes, semanticSearch, type VectorStore } from './core';
import { DIMS, MODELS } from './models';
import type { Note } from '../types';

const note = (title: string, body: string): Note => ({ id: title, type: 'note', title, body, createdAt: 0, updatedAt: 0 });

/** A unit vector mostly along `axis`, with a little of `mix` mixed in. */
function vec(axis: number, mix = -1, amount = 0): Float32Array {
  const v = new Float32Array(DIMS);
  v[axis] = 1;
  if (mix >= 0) v[mix] = amount;
  const len = Math.hypot(...v);
  return v.map((x) => x / len);
}
const store = (entries: Record<string, Float32Array[]>): VectorStore =>
  new Map(
    Object.entries(entries).map(([id, vs]) => {
      const flat = new Float32Array(vs.length * DIMS);
      vs.forEach((v, i) => flat.set(v, i * DIMS));
      return [id, { h: 'x', v: flat }];
    }),
  );
const model = { ...MODELS.en, minScore: 0.5, minLift: 0.2, maxGap: 1, relMinScore: 0.5, relMinLift: 0.2 };

describe('text preparation', () => {
  it('turns Markdown and links into plain words', () => {
    expect(plainText('# Title\n- see [[Sleep|my sleep note]] and [[Coffee]]\n```\ncode\n```\n**bold** [site](http://x)')).toBe(
      'Title\nsee my sleep note and Coffee\n\nbold site',
    );
  });
  it('splits long notes into titled chunks and keeps short ones whole', () => {
    expect(chunkNote(note('Short', 'One line.'))).toEqual(['Short: One line.']);
    expect(chunkNote(note('Doc', 'type:: source\n## Page 1\nAlpha.\n## [1:05](https://x)\nBeta.'))).toEqual([
      'Doc (Page 1): Alpha.',
      'Doc (1:05): Beta.',
    ]);
    expect(chunkNote(note('Empty', ''))).toEqual(['Empty']);
    const long = chunkNote(note('Long', Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ')));
    expect(long).toHaveLength(3);
    expect(long.every((c) => c.startsWith('Long: '))).toBe(true);
    expect(long[0].split(' ')).toHaveLength(121);
    const sections = chunkNote(note('S', '## A\n' + 'a '.repeat(50) + '\n## B\n' + 'b '.repeat(50)));
    expect(sections).toHaveLength(2); // passages never cross a heading
  });
  it('hashes text stably and sensitively', () => {
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('semanticSearch', () => {
  const s = store({ a: [vec(0)], b: [vec(1), vec(0, 2, 0.5)], c: [vec(2)], d: [vec(3)], e: [vec(4)] });
  it('scores a note by its best chunk and returns real matches only', () => {
    const hits = semanticSearch(vec(0), s, model);
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
    expect(hits[1].chunk).toBe(1);
  });
  it('drops matches far below the best one', () => {
    expect(semanticSearch(vec(0), s, { ...model, maxGap: 0.05 }).map((h) => h.id)).toEqual(['a']);
  });
  it('returns nothing when no note is meaningfully closer than the rest', () => {
    expect(semanticSearch(vec(9), s, model)).toEqual([]);
  });
});

describe('relatedNotes', () => {
  const s = store({ a: [vec(0)], b: [vec(0, 1, 0.3)], c: [vec(0, 2, 0.6)], d: [vec(5)], e: [vec(6)] });
  it('finds notes with similar meaning, most similar first', () => {
    expect(relatedNotes('a', s, model, new Set()).map((h) => h.id)).toEqual(['b', 'c']);
  });
  it('skips excluded notes (e.g. already linked)', () => {
    expect(relatedNotes('a', s, model, new Set(['b'])).map((h) => h.id)).toEqual(['c']);
  });
  it('needs a few notes before suggesting anything', () => {
    expect(relatedNotes('a', store({ a: [vec(0)], b: [vec(0)] }), model, new Set())).toEqual([]);
  });
  it('averages chunks into one unit vector per note', () => {
    const v = noteVector({ h: '', v: Float32Array.from([...vec(0), ...vec(1)]) });
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(v[0]).toBeCloseTo(Math.SQRT1_2, 5);
  });
});

describe('fuse', () => {
  it('ranks notes found both ways first and labels how each was found', () => {
    const out = fuse([{ id: 'x' }, { id: 'y' }], [{ id: 'y', score: 0.9, chunk: 0 }, { id: 'z', score: 0.8, chunk: 2 }]);
    expect(out.map((r) => r.id)).toEqual(['y', 'x', 'z']);
    expect(out[0]).toMatchObject({ byText: true, byMeaning: { chunk: 0 } });
    expect(out[2]).toMatchObject({ byText: false, byMeaning: { chunk: 2 } });
  });
});
