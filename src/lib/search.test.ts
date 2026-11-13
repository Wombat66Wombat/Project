import { describe, expect, it } from 'vitest';
import { buildSearch, runSearch } from './search';
import { parseNotes } from './store';
import type { Note } from './types';

const notes: Note[] = [
  { id: '1', type: 'note', title: 'Sleep and memory', body: 'Deep sleep consolidates memories.', createdAt: 0, updatedAt: 0 },
  { id: '2', type: 'note', title: 'Coffee', body: 'Caffeine blocks adenosine, which affects [[Sleep and memory|sleep]].', createdAt: 0, updatedAt: 0 },
];

describe('search', () => {
  const ms = buildSearch(notes);
  it('ranks title matches first and supports prefixes', () => {
    const hits = runSearch(ms, 'slee');
    expect(hits[0].id).toBe('1');
    expect(hits.map((h) => h.id)).toContain('2');
  });
  it('tolerates typos', () => {
    expect(runSearch(ms, 'cafeine')[0]?.id).toBe('2');
  });
  it('returns nothing for a blank query', () => {
    expect(runSearch(ms, '   ')).toEqual([]);
  });
  it('makes readable snippets without link syntax', () => {
    const hit = runSearch(ms, 'adenosine')[0];
    expect(hit.snippet).toContain('adenosine');
    expect(hit.snippet).not.toContain('[[');
  });
});

describe('parseNotes', () => {
  it('accepts an export file and drops invalid entries', () => {
    const json = JSON.stringify({ notes: [notes[0], { id: 3 }, null] });
    expect(parseNotes(json)).toHaveLength(1);
  });
  it('rejects files without notes', () => {
    expect(() => parseNotes('{"foo":1}')).toThrow();
  });
});
