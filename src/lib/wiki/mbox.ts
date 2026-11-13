export interface Address {
  name: string;
  email: string;
}

export interface Email {
  id: string;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  date: number | null;
  text: string;
  inReplyTo: string;
  references: string[];
  /** The mailbox owner's address, when the export records it (Delivered-To / X-Original-To). */
  deliveredTo: string;
}

/** Decode RFC 2047 encoded words in headers, e.g. =?UTF-8?B?...?= or =?utf-8?Q?...?=. */
export function decodeWords(s: string): string {
  return s
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, data: string) => {
      try {
        const bytes =
          enc.toUpperCase() === 'B'
            ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
            : qpBytes(data.replace(/_/g, ' '));
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return data;
      }
    });
}

function qpBytes(s: string): Uint8Array {
  const out: number[] = [];
  const src = s.replace(/=\r?\n/g, '');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = src.charCodeAt(i);
      if (code < 128) out.push(code);
      else out.push(...new TextEncoder().encode(src[i]));
    }
  }
  return Uint8Array.from(out);
}

function decodeBody(raw: string, encoding: string, charset: string): string {
  let bytes: Uint8Array;
  const enc = encoding.toLowerCase();
  if (enc === 'base64') {
    try {
      bytes = Uint8Array.from(atob(raw.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    } catch {
      return raw;
    }
  } else if (enc === 'quoted-printable') {
    bytes = qpBytes(raw);
  } else {
    return raw;
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function parseHeaders(block: string): Map<string, string> {
  const h = new Map<string, string>();
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m && !h.has(m[1].toLowerCase())) h.set(m[1].toLowerCase(), m[2]);
  }
  return h;
}

const param = (header: string, name: string) => new RegExp(`${name}="?([^";]+)"?`, 'i').exec(header)?.[1] ?? '';

/** The readable text of a MIME entity: text/plain preferred, else text/html stripped. */
function bodyText(headers: Map<string, string>, body: string): string {
  const type = headers.get('content-type') ?? 'text/plain';
  if (/^multipart\//i.test(type)) {
    const boundary = param(type, 'boundary');
    if (!boundary) return '';
    const parts = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*\\r?\\n`));
    let plain = '';
    let html = '';
    for (const p of parts) {
      const split = p.search(/\r?\n\r?\n/);
      if (split < 0) continue;
      const ph = parseHeaders(p.slice(0, split));
      const pb = p.slice(split).replace(/^\r?\n\r?\n/, '');
      const pt = ph.get('content-type') ?? 'text/plain';
      if (/attachment/i.test(ph.get('content-disposition') ?? '')) continue;
      if (/^multipart\//i.test(pt)) plain ||= bodyText(ph, pb);
      else if (/^text\/plain/i.test(pt)) plain ||= decodeBody(pb, ph.get('content-transfer-encoding') ?? '', param(pt, 'charset'));
      else if (/^text\/html/i.test(pt)) html ||= decodeBody(pb, ph.get('content-transfer-encoding') ?? '', param(pt, 'charset'));
    }
    return plain || htmlToText(html);
  }
  const text = decodeBody(body, headers.get('content-transfer-encoding') ?? '', param(type, 'charset'));
  return /^text\/html/i.test(type) ? htmlToText(text) : text;
}

function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style').forEach((e) => e.remove());
  doc.querySelectorAll('br').forEach((e) => e.replaceWith('\n'));
  doc.querySelectorAll('p,div,li,tr').forEach((e) => e.append('\n'));
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n');
}

/** Drop quoted earlier messages and signatures, which repeat across a thread. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) continue;
    if (/^On .{5,200} wrote:\s*$/.test(l) || /^Am .{5,200} schrieb .*:\s*$/.test(l) || /^-----\s*Original Message\s*-----/i.test(l)) break;
    if (/^-- ?$/.test(l)) break; // signature
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function parseAddresses(s: string): Address[] {
  const out: Address[] = [];
  for (const part of decodeWords(s).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(part) ?? /^\s*()([^\s<>]+@[^\s<>]+)\s*$/.exec(part);
    if (m) out.push({ name: m[1].trim(), email: m[2].trim().toLowerCase() });
  }
  return out;
}

function parseMessage(raw: string, i: number): Email | null {
  const split = raw.search(/\r?\n\r?\n/);
  if (split < 0) return null;
  const h = parseHeaders(raw.slice(0, split));
  const body = raw.slice(split).replace(/^\r?\n\r?\n/, '').replace(/^>From /gm, 'From ');
  const from = parseAddresses(h.get('from') ?? '')[0];
  if (!from) return null;
  const date = Date.parse(h.get('date') ?? '');
  return {
    id: (h.get('message-id') ?? `msg-${i}`).trim(),
    subject: decodeWords(h.get('subject') ?? '(no subject)').trim() || '(no subject)',
    from,
    to: parseAddresses(h.get('to') ?? ''),
    cc: parseAddresses(h.get('cc') ?? ''),
    date: Number.isFinite(date) ? date : null,
    text: stripQuoted(bodyText(h, body)),
    inReplyTo: (h.get('in-reply-to') ?? '').trim(),
    references: (h.get('references') ?? '').split(/\s+/).filter(Boolean),
    deliveredTo: (parseAddresses(h.get('delivered-to') ?? h.get('x-original-to') ?? '')[0]?.email ?? ''),
  };
}

/** Parse an .mbox file (many messages) or a single .eml message. */
export function parseMail(text: string): Email[] {
  const src = text.replace(/\r\n/g, '\n');
  const chunks = /^From \S+/m.test(src.slice(0, 200)) ? src.split(/\n(?=From \S+.*\n[\w-]+:)/) : [src];
  return chunks
    .map((c, i) => parseMessage(c.replace(/^From [^\n]*\n/, ''), i))
    .filter((m): m is Email => !!m);
}

export interface Thread {
  id: string;
  subject: string;
  emails: Email[];
}

const baseSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|wg|tr)\s*:\s*)+/i, '').trim().toLowerCase();

/** Group emails into conversations by reply headers, falling back to the subject. */
export function threads(emails: Email[]): Thread[] {
  const byId = new Map(emails.map((e) => [e.id, e]));
  const rootOf = (e: Email): string => {
    const first = e.references[0] ?? e.inReplyTo;
    if (first && byId.has(first)) return rootOf(byId.get(first)!) || first;
    return first || `subject:${baseSubject(e.subject)}`;
  };
  const groups = new Map<string, Email[]>();
  const subjectKey = new Map<string, string>();
  for (const e of emails) {
    let key = rootOf(e);
    const sk = `subject:${baseSubject(e.subject)}`;
    // Messages without usable references join the thread with the same subject.
    if (!e.references.length && !e.inReplyTo && subjectKey.has(sk)) key = subjectKey.get(sk)!;
    if (!subjectKey.has(sk)) subjectKey.set(sk, key);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([id, list]) => {
    const sorted = list.sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
    return { id, subject: sorted[0].subject.replace(/^\s*((re|fw|fwd|aw|wg)\s*:\s*)+/i, '').trim(), emails: sorted };
  });
}

/** Likely owner addresses of a mailbox, best guess first: Delivered-To headers, then the most frequent address. */
export function ownerCandidates(emails: Email[]): string[] {
  const delivered = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const e of emails) {
    if (e.deliveredTo) delivered.set(e.deliveredTo, (delivered.get(e.deliveredTo) ?? 0) + 1);
    for (const a of [e.from, ...e.to, ...e.cc]) seen.set(a.email, (seen.get(a.email) ?? 0) + 1);
  }
  const byCount = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return [...new Set([...byCount(delivered), ...byCount(seen)])].slice(0, 12);
}
