/**
 * Inline fields: lines like `type:: decision` or `supports:: [[Claim A]]` (the same syntax as
 * Obsidian's Dataview plugin). They give notes structure while staying plain, portable text,
 * so every feature built on them (decisions, recipes, sources, arguments) syncs and searches
 * like any other note.
 */
export interface Field {
  key: string;
  value: string;
  /** [[Link]] targets in the value. */
  links: string[];
  /** 0-based line number in the body. */
  line: number;
}

const FIELD = /^\s*([A-Za-z][\w-]*)::[ \t]*(.*)$/;
const LINK = /\[\[([^\[\]|\n]+?)(?:\|[^\[\]\n]+?)?\]\]/g;

/** All fields in a body, skipping fenced code blocks. Keys are lower-cased. */
export function parseFields(body: string): Field[] {
  const out: Field[] = [];
  let inCode = false;
  body.split('\n').forEach((text, line) => {
    if (/^\s*```/.test(text)) inCode = !inCode;
    if (inCode) return;
    const m = FIELD.exec(text);
    if (!m) return;
    const value = m[2].trim();
    out.push({ key: m[1].toLowerCase(), value, links: [...value.matchAll(LINK)].map((l) => l[1].trim()), line });
  });
  return out;
}

export function getField(body: string, key: string): string | undefined {
  return parseFields(body).find((f) => f.key === key.toLowerCase())?.value;
}

/** A note's kind, from its `type::` field ("note" if none). */
export function noteKind(body: string): string {
  return (getField(body, 'type') ?? 'note').toLowerCase();
}

/** Set (or add) a field. New fields go after the existing field block at the top, or first. */
export function setField(body: string, key: string, value: string): string {
  const k = key.toLowerCase();
  const lines = body.split('\n');
  const fields = parseFields(body);
  const existing = fields.find((f) => f.key === k);
  if (existing) {
    lines[existing.line] = `${key}:: ${value}`;
    return lines.join('\n');
  }
  // Insert after the leading run of field lines, if any.
  let at = 0;
  while (at < lines.length && FIELD.test(lines[at])) at++;
  lines.splice(at, 0, `${key}:: ${value}`);
  return lines.join('\n');
}

/** Number from a field like "70", "70%", "0.7" (→ 70 when `percent`). */
export function numberField(body: string, key: string, percent = false): number | null {
  const v = getField(body, key);
  if (!v) return null;
  const n = parseFloat(v.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return percent && n > 0 && n <= 1 && !v.includes('%') ? n * 100 : n;
}

/** Field keys that are typed relationships between notes (shown in the argument map). */
export const RELATIONS = ['supports', 'contradicts', 'evidence', 'rebuts', 'source'] as const;
export type Relation = (typeof RELATIONS)[number];
