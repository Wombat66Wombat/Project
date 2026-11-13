import type { Note } from '../types';

export interface Passage {
  text: string;
  /** The heading the passage sits under, e.g. "Page 4" or "12:30" (plain text), or "" before any heading. */
  section: string;
}

const MAX_WORDS = 120;
const MAX_PASSAGES = 400;

/** Heading text without Markdown: "## [12:30](https://…)" → "12:30". */
export function headingText(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

/** Markdown → plain words for reading and matching. */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~]+/g, ' ')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The note's paragraphs as plain text, each with its section (fields and code skipped). */
export function noteParagraphs(n: Note): Passage[] {
  const paras: Passage[] = [];
  let section = '';
  let inCode = false;
  let buf: string[] = [];
  const end = () => {
    const text = plainText(buf.join('\n')).replace(/\s+/g, ' ').trim();
    if (text) paras.push({ text, section });
    buf = [];
  };
  for (const line of n.body.split('\n')) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    if (!inCode && /^#{1,6}\s/.test(line)) {
      end();
      section = headingText(line);
      continue;
    }
    if (!inCode && /^\s*[A-Za-z][\w-]*::/.test(line)) continue;
    if (!line.trim()) end();
    else buf.push(line);
  }
  end();
  return paras;
}

/**
 * Split a note into passages of up to ~120 words that never cross a heading, so each one
 * can be cited by its section (a PDF page, a video timestamp, an article heading).
 * Field lines (`key:: value`) are left out; they're structure, not content.
 */
export function notePassages(n: Note): Passage[] {
  const out: Passage[] = [];
  let section = '';
  let words: string[] = [];
  const flush = () => {
    if (words.length) out.push({ text: words.join(' '), section });
    words = [];
  };
  const paras = noteParagraphs(n);
  let lastSection: string | null = null;
  for (const p of paras) {
    if (p.section !== lastSection) {
      flush();
      section = p.section;
      lastSection = p.section;
    }
    const w = p.text.split(/\s+/).filter(Boolean);
    for (let i = 0; i < w.length; i += MAX_WORDS) {
      const piece = w.slice(i, i + MAX_WORDS);
      if (words.length + piece.length > MAX_WORDS) flush();
      words.push(...piece);
    }
  }
  flush();
  return out.slice(0, MAX_PASSAGES);
}
