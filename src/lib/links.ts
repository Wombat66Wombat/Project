import type { GraphIndex, LinkRef, Note } from './types';

/** Matches [[Target]] and [[Target|Alias]]. Targets can't contain ] or | or newlines. */
const WIKILINK = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Remove fenced and inline code so links inside code aren't counted. */
function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
}

export function extractLinks(body: string): LinkRef[] {
  const out: LinkRef[] = [];
  for (const m of stripCode(body).matchAll(WIKILINK)) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({ target, label: (m[2] ?? m[1]).trim() });
  }
  return out;
}

export function buildIndex(notes: Note[]): GraphIndex {
  const byTitle = new Map<string, Note>();
  const byId = new Map<string, Note>();
  for (const n of notes) {
    byId.set(n.id, n);
    const key = normalizeTitle(n.title);
    // First note wins if two share a title; keeps resolution stable.
    if (key && !byTitle.has(key)) byTitle.set(key, n);
  }

  const outgoing = new Map<string, Set<string>>();
  const backlinks = new Map<string, Set<string>>();
  const unresolved = new Map<string, Set<string>>();
  for (const n of notes) {
    outgoing.set(n.id, new Set());
    backlinks.set(n.id, backlinks.get(n.id) ?? new Set());
    unresolved.set(n.id, new Set());
  }

  for (const n of notes) {
    for (const link of extractLinks(n.body)) {
      const target = byTitle.get(normalizeTitle(link.target));
      if (!target) {
        unresolved.get(n.id)!.add(link.target);
        continue;
      }
      if (target.id === n.id) continue; // ignore self-links
      outgoing.get(n.id)!.add(target.id);
      backlinks.get(target.id)!.add(n.id);
    }
  }

  return { byTitle, byId, outgoing, backlinks, unresolved };
}

/**
 * Rewrite [[Old]] / [[Old|alias]] references to point at a renamed note.
 * Matching is case/whitespace-insensitive; aliases and code spans are preserved.
 */
export function renameLinks(body: string, oldTitle: string, newTitle: string): string {
  const oldKey = normalizeTitle(oldTitle);
  if (!oldKey || !newTitle.trim() || oldTitle.trim() === newTitle.trim()) return body;
  // Split out code so we never rewrite inside it.
  const parts = body.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // code segment
      return part.replace(WIKILINK, (whole, target: string, alias?: string) => {
        if (normalizeTitle(target) !== oldKey) return whole;
        return alias !== undefined ? `[[${newTitle}|${alias}]]` : `[[${newTitle}]]`;
      });
    })
    .join('');
}
