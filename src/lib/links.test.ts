import { describe, expect, it } from 'vitest';
import { buildIndex, extractLinks, renameLinks } from './links';
import type { Note } from './types';

const note = (id: string, title: string, body: string): Note => ({
  id, type: 'note', title, body, createdAt: 0, updatedAt: 0,
});

describe('extractLinks', () => {
  it('finds plain and aliased links', () => {
    expect(extractLinks('See [[Alpha]] and [[Beta|the second]].')).toEqual([
      { target: 'Alpha', label: 'Alpha' },
      { target: 'Beta', label: 'the second' },
    ]);
  });
  it('ignores links inside code', () => {
    expect(extractLinks('`[[Nope]]`\n```\n[[Also no]]\n```\n[[Yes]]')).toEqual([{ target: 'Yes', label: 'Yes' }]);
  });
  it('ignores empty and multi-line brackets', () => {
    expect(extractLinks('[[ ]] [[a\nb]]')).toEqual([]);
  });
});

describe('buildIndex', () => {
  const notes = [
    note('a', 'Alpha', 'links to [[beta]] and [[Missing]] and [[Alpha]]'),
    note('b', 'Beta', 'back to [[ALPHA]] twice [[Alpha]]'),
    note('c', 'Gamma', 'no links'),
  ];
  const idx = buildIndex(notes);

  it('resolves case-insensitively and de-duplicates', () => {
    expect([...idx.outgoing.get('a')!]).toEqual(['b']);
    expect([...idx.outgoing.get('b')!]).toEqual(['a']);
  });
  it('builds backlinks', () => {
    expect([...idx.backlinks.get('a')!]).toEqual(['b']);
    expect(idx.backlinks.get('c')!.size).toBe(0);
  });
  it('tracks unresolved targets and ignores self-links', () => {
    expect([...idx.unresolved.get('a')!]).toEqual(['Missing']);
    expect(idx.outgoing.get('a')!.has('a')).toBe(false);
  });
});

describe('renameLinks', () => {
  it('rewrites matching links and keeps aliases', () => {
    expect(renameLinks('[[old note]] and [[Old Note|alias]] and [[Other]]', 'Old note', 'New')).toBe(
      '[[New]] and [[New|alias]] and [[Other]]',
    );
  });
  it('leaves code untouched', () => {
    expect(renameLinks('`[[Old]]` [[Old]]', 'Old', 'New')).toBe('`[[Old]]` [[New]]');
  });
  it('is a no-op for an unchanged or empty title', () => {
    expect(renameLinks('[[Old]]', 'Old', 'Old')).toBe('[[Old]]');
    expect(renameLinks('[[Old]]', 'Old', '  ')).toBe('[[Old]]');
  });
});
