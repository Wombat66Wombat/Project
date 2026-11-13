import type { Conversation } from './chats';
import { ownerCandidates, type Address, type Thread } from './mbox';
import { extractTopics, findDecisions, topicTitle } from './topics';

export interface WikiNote {
  title: string;
  body: string;
  kind: 'conversation' | 'email' | 'person' | 'topic' | 'decisions';
  /** For skipping re-imports. */
  key?: string;
}

export interface WikiPlan {
  notes: WikiNote[];
  stats: { conversations: number; threads: number; people: number; topics: number; decisions: number; skipped: number };
}

const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const clip = (s: string, max = 20000) => (s.length > max ? `${s.slice(0, max)}\n\n*(shortened)*` : s);
/** Markdown that can't break the note: no stray headings or fields from pasted content. */
const safe = (s: string) => s.replace(/^(#{1,6})\s/gm, '$1​ ').replace(/^(\s*[A-Za-z][\w-]*)::/gm, '$1​::');
const personTitle = (a: Address) => (a.name && !a.name.includes('@') ? a.name : a.email);

/**
 * Turn conversations and email threads into wiki notes: one note per conversation/thread,
 * a page per person you exchange email with, a page per topic that links several of them,
 * and one list of decisions found in the text. `existing` holds keys already imported
 * (chatid/thread fields) and titles already used.
 */
export function buildWiki(
  conversations: Conversation[],
  mail: Thread[],
  existing: { keys: Set<string>; titles: Set<string> },
  options: { people?: boolean; topics?: boolean; owner?: string } = {},
): WikiPlan {
  const opts = { people: true, topics: true, ...options };
  const existingLower = new Set([...existing.titles].map((t) => t.toLowerCase()));
  const titles = new Set(existingLower);
  const unique = (base: string) => {
    const clean = base.replace(/[[\]|#^]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
    let t = clean;
    for (let i = 2; titles.has(t.toLowerCase()); i++) t = `${clean} ${i}`;
    titles.add(t.toLowerCase());
    return t;
  };
  const convs = conversations.filter((c) => !existing.keys.has(`chat:${c.id}`));
  const threads = mail.filter((t) => !existing.keys.has(`thread:${t.id}`));
  const skipped = conversations.length - convs.length + (mail.length - threads.length);

  // The mailbox owner (you) doesn't need a person page.
  const owner = (opts.owner ?? ownerCandidates(threads.flatMap((t) => t.emails))[0] ?? '').toLowerCase();

  const docs = [
    ...convs.map((c) => ({ id: `c:${c.id}`, text: `${c.title}\n${c.messages.map((m) => m.text).join('\n')}` })),
    ...threads.map((t) => ({ id: `t:${t.id}`, text: `${t.subject}\n${t.emails.map((e) => e.text).join('\n')}` })),
  ];
  const topics = opts.topics ? extractTopics(docs) : new Map<string, string[]>();
  const topicNames = new Map<string, string>();
  for (const list of topics.values()) for (const t of list) if (!topicNames.has(t)) topicNames.set(t, topicTitle(t));

  const notes: WikiNote[] = [];
  const decisions: { text: string; from: string }[] = [];
  const people = new Map<string, { addr: Address; title: string; threads: number; first: number | null; last: number | null }>();
  const topicLinks = (id: string) => (topics.get(id) ?? []).map((t) => `[[${topicNames.get(t)}]]`).join(', ');

  for (const c of convs) {
    const title = unique(c.title);
    const topicsLine = topicLinks(`c:${c.id}`);
    const lines = [`type:: conversation`, `platform:: ${c.platform}`, c.created ? `date:: ${day(c.created)}` : '', topicsLine ? `topics:: ${topicsLine}` : '', `chatid:: ${c.id}`].filter(Boolean);
    const body = c.messages.map((m) => `## ${m.role === 'user' ? 'You' : c.platform}\n${safe(clip(m.text))}`).join('\n\n');
    notes.push({ title, body: `${lines.join('\n')}\n\n${body}`, kind: 'conversation', key: `chat:${c.id}` });
    for (const m of c.messages) if (m.role === 'user') for (const d of findDecisions(m.text)) decisions.push({ text: d, from: title });
  }

  for (const t of threads) {
    const title = unique(t.subject || 'Email thread');
    const others = new Map<string, Address>();
    for (const e of t.emails) for (const a of [e.from, ...e.to, ...e.cc]) if (a.email !== owner) others.set(a.email, a);
    if (opts.people) {
      for (const a of others.values()) {
        const p = people.get(a.email) ?? { addr: a, title: '', threads: 0, first: null, last: null };
        p.threads++;
        if (!p.addr.name && a.name) p.addr = a;
        const dates = t.emails.map((e) => e.date ?? 0).filter(Boolean);
        if (dates.length) {
          p.first = Math.min(p.first ?? Infinity, ...dates);
          p.last = Math.max(p.last ?? 0, ...dates);
        }
        people.set(a.email, p);
      }
    }
    const topicsLine = topicLinks(`t:${t.id}`);
    const withLine = [...others.values()].map((a) => `[[${personTitle(a)}]]`).join(', ');
    const lines = [`type:: email`, t.emails[0].date ? `date:: ${day(t.emails[0].date)}` : '', withLine && opts.people ? `with:: ${withLine}` : '', topicsLine ? `topics:: ${topicsLine}` : '', `thread:: ${t.id}`].filter(Boolean);
    const body = t.emails.map((e) => `## ${personTitle(e.from)}${e.date ? ` · ${day(e.date)}` : ''}\n${safe(clip(e.text, 8000)) || '*(no text)*'}`).join('\n\n');
    notes.push({ title, body: `${lines.join('\n')}\n\n${body}`, kind: 'email', key: `thread:${t.id}` });
    for (const e of t.emails) for (const d of findDecisions(e.text)) decisions.push({ text: d, from: title });
  }

  // Person pages: their threads link to them, so each page's backlinks are the conversation history.
  const personTitles = new Map<string, string>();
  for (const p of [...people.values()].sort((a, b) => b.threads - a.threads).slice(0, 150)) {
    const base = personTitle(p.addr);
    if (existingLower.has(base.toLowerCase())) {
      personTitles.set(p.addr.email, base);
      continue;
    }
    const title = unique(base);
    personTitles.set(p.addr.email, title);
    const span = p.first ? ` between ${day(p.first)} and ${day(p.last)}` : '';
    notes.push({
      title,
      kind: 'person',
      body: `type:: person\nemail:: ${p.addr.email}\n\n${p.threads} email thread${p.threads === 1 ? '' : 's'} together${span}. They’re listed under “Linked from” below.`,
    });
  }
  // Topic pages, unless a note with that name exists already (then threads link to it).
  for (const name of topicNames.values()) {
    // A note with this name already exists (from before, or just created): links resolve to it.
    if (existingLower.has(name.toLowerCase()) || notes.some((x) => x.title.toLowerCase() === name.toLowerCase())) continue;
    titles.add(name.toLowerCase());
    const n = [...topics.values()].filter((l) => l.some((t) => topicNames.get(t) === name)).length;
    notes.push({ title: name, kind: 'topic', body: `type:: topic\n\nComes up in ${n} imported conversation${n === 1 ? '' : 's'} and email thread${n === 1 ? '' : 's'}, listed under “Linked from” below.` });
  }
  if (decisions.length) {
    const title = unique('Decisions from chats and email');
    notes.push({
      title,
      kind: 'decisions',
      body: `type:: decisions\n\nSentences that sound like decisions, found while importing. Turn the important ones into decision notes (New ▾ → Decision) to track how they turn out.\n\n${decisions
        .slice(0, 300)
        .map((d) => `- [ ] ${safe(d.text)} — [[${d.from}]]`)
        .join('\n')}`,
    });
  }
  return {
    notes,
    stats: {
      conversations: convs.length,
      threads: threads.length,
      people: notes.filter((x) => x.kind === 'person').length,
      topics: notes.filter((x) => x.kind === 'topic').length,
      decisions: decisions.length,
      skipped,
    },
  };
}
