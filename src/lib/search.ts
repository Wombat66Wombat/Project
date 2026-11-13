import MiniSearch from 'minisearch';
import type { Note } from './types';

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
}

export function buildSearch(notes: Note[]): MiniSearch<Note> {
  const ms = new MiniSearch<Note>({
    fields: ['title', 'body'],
    storeFields: ['title', 'body'],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2, combineWith: 'AND' },
  });
  ms.addAll(notes);
  return ms;
}

/** A short excerpt of `body` around the first matched term. */
export function snippet(body: string, terms: string[], radius = 60): string {
  const plain = body.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, t, a) => a || t).replace(/[#*_`>]/g, '');
  const lower = plain.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return plain.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
  const start = Math.max(0, at - radius);
  const end = Math.min(plain.length, at + radius);
  return (start > 0 ? '…' : '') + plain.slice(start, end).replace(/\s+/g, ' ').trim() + (end < plain.length ? '…' : '');
}

export function runSearch(ms: MiniSearch<Note>, query: string): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  return ms.search(q).slice(0, 50).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    snippet: snippet(r.body as string, r.terms),
  }));
}
