import type { Note } from './types';

/**
 * How a note is stored as a file on GitHub:
 *
 *   ---
 *   id: "3f2a…"
 *   title: "My note"
 *   created: "2026-11-13T12:00:00.000Z"
 *   updated: "2026-11-13T12:30:00.000Z"
 *   ---
 *   The body, in Markdown.
 *
 * Values are JSON strings, which are also valid YAML, so Obsidian and GitHub read them fine.
 */
export function serializeNote(n: Note): string {
  const fm = [
    '---',
    `id: ${JSON.stringify(n.id)}`,
    `title: ${JSON.stringify(n.title)}`,
    `created: ${JSON.stringify(new Date(n.createdAt).toISOString())}`,
    `updated: ${JSON.stringify(new Date(n.updatedAt).toISOString())}`,
    '---',
    '',
  ].join('\n');
  return fm + n.body + (n.body.endsWith('\n') ? '' : '\n');
}

function parseValue(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v));
    } catch {
      /* fall through */
    }
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** Title from a path like "notes/My idea.md" → "My idea". */
export function titleFromPath(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

/**
 * Parse a Markdown file. Files written by other tools (no front matter, or no id)
 * still work: the id falls back to one derived from the path, the title to the file name.
 */
export function parseNoteFile(text: string, path: string, fallbackTime = Date.now()): Note {
  const src = text.replace(/\r\n/g, '\n');
  const meta: Record<string, string> = {};
  let body = src;
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
      if (kv) meta[kv[1]] = parseValue(kv[2]);
    }
    body = src.slice(m[0].length);
  }
  if (body.endsWith('\n')) body = body.slice(0, -1);
  const time = (s: string | undefined) => {
    const t = s ? Date.parse(s) : NaN;
    return Number.isFinite(t) ? t : fallbackTime;
  };
  return {
    id: meta.id || `gh:${path}`,
    type: 'note',
    title: meta.title || titleFromPath(path),
    body,
    createdAt: time(meta.created),
    updatedAt: time(meta.updated ?? meta.created),
  };
}

/** A safe, readable file name from a title. Keeps letters in any language. */
export function slugify(title: string): string {
  const s = title
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return s || 'Untitled';
}

const utf8 = new TextEncoder();

export function toBase64(text: string): string {
  let bin = '';
  for (const b of utf8.encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The SHA git gives a file with this content, so we know what's on GitHub without re-downloading. */
export async function gitBlobSha(text: string): Promise<string> {
  const content = utf8.encode(text);
  const header = utf8.encode(`blob ${content.length}\0`);
  const buf = new Uint8Array(header.length + content.length);
  buf.set(header);
  buf.set(content, header.length);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
