import { describe, expect, it } from 'vitest';
import { fromBase64, gitBlobSha, parseNoteFile, serializeNote, slugify, toBase64 } from './noteFile';
import type { Note } from './types';

const note: Note = {
  id: 'abc',
  type: 'note',
  title: 'Ideas: "big" ones',
  body: 'Line one\n\n- [[Link]]',
  createdAt: Date.UTC(2026, 0, 2),
  updatedAt: Date.UTC(2026, 0, 3),
};

describe('note files', () => {
  it('round-trips through serialize and parse', () => {
    expect(parseNoteFile(serializeNote(note), 'notes/x.md')).toEqual(note);
  });
  it('reads plain Markdown files from other tools', () => {
    const n = parseNoteFile('# Hello\r\nworld\r\n', 'notes/sub/My page.md', 5);
    expect(n).toMatchObject({ id: 'gh:notes/sub/My page.md', title: 'My page', body: '# Hello\nworld', createdAt: 5 });
  });
  it('reads unquoted YAML values', () => {
    const n = parseNoteFile('---\ntitle: Plain title\nid: x1\n---\nbody', 'notes/a.md');
    expect(n).toMatchObject({ id: 'x1', title: 'Plain title', body: 'body' });
  });
  it('makes safe file names', () => {
    expect(slugify('What? A/B: test*')).toBe('What A B test');
    expect(slugify('Ünïcödé 日本')).toBe('Ünïcödé 日本');
    expect(slugify('   ')).toBe('Untitled');
    expect(slugify('..hidden')).toBe('hidden');
  });
  it('encodes UTF-8 base64 both ways', () => {
    expect(fromBase64(toBase64('héllo 日本 🎉'))).toBe('héllo 日本 🎉');
  });
  it('computes the same blob SHA as git', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
