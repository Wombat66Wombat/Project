import { describe, expect, it } from 'vitest';
import { parseConversations } from './chats';
import { decodeWords, parseAddresses, parseMail, stripQuoted, threads } from './mbox';
import { extractTopics, findDecisions } from './topics';
import { buildWiki } from './build';
import { buildIndex } from '../links';
import type { Note } from '../types';

const chatgpt = JSON.stringify([
  {
    title: 'Planning the Lisbon trip',
    create_time: 1767225600,
    conversation_id: 'cg-1',
    current_node: 'n3',
    mapping: {
      n0: { id: 'n0', message: null, parent: null, children: ['n1'] },
      n1: { id: 'n1', parent: 'n0', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Help me plan a Lisbon trip budget. We decided to stay in Alfama.'] }, create_time: 1767225600 } },
      n2: { id: 'n2', parent: 'n1', message: { author: { role: 'assistant' }, content: { parts: ['An old branch that was regenerated.'] } } },
      n3: { id: 'n3', parent: 'n1', message: { author: { role: 'assistant' }, content: { parts: ['Here is a Lisbon trip budget: flights, Alfama hotel, food.'] } } },
    },
  },
]);
const claude = JSON.stringify([
  {
    uuid: 'cl-1',
    name: 'Lisbon trip packing',
    created_at: '2026-01-03T10:00:00Z',
    chat_messages: [
      { sender: 'human', text: 'What should I pack for the Lisbon trip budget version?', created_at: '2026-01-03T10:00:00Z' },
      { sender: 'assistant', text: '', content: [{ type: 'text', text: 'For a Lisbon trip on a budget, pack light.' }] },
    ],
  },
]);

const mbox = [
  'From anna@example.com Mon Jan  5 10:00:00 2026',
  'From: Anna Silva <anna@example.com>',
  'To: Me <me@example.com>',
  'Delivered-To: me@example.com',
  'Subject: =?UTF-8?B?TGlzYm9uIGZsaWdodHMg4pyI?=',
  'Date: Mon, 5 Jan 2026 10:00:00 +0000',
  'Message-ID: <a1@example.com>',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hi! Flights to Lisbon are cheap in May. Caf=C3=A9 near Alfama is great.',
  '',
  'From me@example.com Mon Jan  5 12:00:00 2026',
  'From: Me <me@example.com>',
  'To: Anna Silva <anna@example.com>, "Bob, Jr." <bob@example.com>',
  'Subject: Re: Lisbon flights ✈',
  'Date: Mon, 5 Jan 2026 12:00:00 +0000',
  'Message-ID: <a2@example.com>',
  'In-Reply-To: <a1@example.com>',
  'References: <a1@example.com>',
  'Content-Type: multipart/alternative; boundary="XYZ"',
  '',
  '--XYZ',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  btoa('Great, we decided to book the May flights. Lisbon here we come!\n\nOn Mon, Anna wrote:\n> Hi! Flights to Lisbon'),
  '--XYZ',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>ignored html</p>',
  '--XYZ--',
  '',
].join('\n');

describe('chat exports', () => {
  it('reads ChatGPT (following the current branch) and Claude', () => {
    const [c] = parseConversations(chatgpt);
    expect(c).toMatchObject({ id: 'cg-1', platform: 'ChatGPT', title: 'Planning the Lisbon trip', created: 1767225600000 });
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(c.messages[1].text).toContain('Here is a Lisbon trip budget');
    const [k] = parseConversations(claude);
    expect(k).toMatchObject({ id: 'cl-1', platform: 'Claude', messages: [{ role: 'user' }, { role: 'assistant', text: 'For a Lisbon trip on a budget, pack light.' }] });
  });
  it('explains files that are not chat exports', () => {
    expect(() => parseConversations('{"x":1}')).toThrow(/No conversations/);
    expect(() => parseConversations('nope')).toThrow(/valid JSON/);
  });
});

describe('email', () => {
  it('parses mbox with encoded headers, quoted-printable, base64 and multipart', () => {
    const mails = parseMail(mbox);
    expect(mails).toHaveLength(2);
    expect(mails[0]).toMatchObject({ subject: 'Lisbon flights ✈', from: { name: 'Anna Silva', email: 'anna@example.com' } });
    expect(mails[0].text).toContain('Café near Alfama');
    expect(mails[1].text).toBe('Great, we decided to book the May flights. Lisbon here we come!');
    expect(mails[1].to.map((a) => a.email)).toEqual(['anna@example.com', 'bob@example.com']);
    expect(threads(mails)).toHaveLength(1);
  });
  it('knows whose mailbox it is', async () => {
    const { ownerCandidates } = await import('./mbox');
    expect(ownerCandidates(parseMail(mbox))[0]).toBe('me@example.com');
  });
  it('decodes words, addresses and strips quotes and signatures', () => {
    expect(decodeWords('=?iso-8859-1?Q?M=FCnchen_Trip?=')).toBe('München Trip');
    expect(parseAddresses('"Doe, Jane" <JANE@x.org>, bob@y.org')).toEqual([
      { name: 'Doe, Jane', email: 'jane@x.org' },
      { name: '', email: 'bob@y.org' },
    ]);
    expect(stripQuoted('Thanks!\n> old\nmore\n-- \nSig')).toBe('Thanks!\nmore');
  });
});

describe('topics and decisions', () => {
  it('finds topics shared by several documents', () => {
    const t = extractTopics([
      { id: 'a', text: 'Lisbon trip budget. Lisbon trip flights. Hotel in Alfama.' },
      { id: 'b', text: 'Packing for the Lisbon trip. Lisbon trip weather.' },
      { id: 'c', text: 'React hooks and React state for the app. React hooks again.' },
      { id: 'd', text: 'Unrelated note about gardening and gardening tools, gardening.' },
    ]);
    expect(t.get('a')).toContain('lisbon trip');
    expect(t.get('b')).toContain('lisbon trip');
    expect(t.get('c')).toEqual([]); // only in one document
  });
  it('spots decisions but not questions', () => {
    expect(findDecisions('We talked a lot. We decided to launch in March. Should we hire? Let’s go with the blue logo.')).toEqual([
      'We decided to launch in March.',
    ]);
    expect(findDecisions("Let's go with the blue logo for now.")).toHaveLength(1);
    expect(findDecisions('Wir haben uns entschieden, im Mai zu fliegen.')).toHaveLength(1);
  });
});

describe('buildWiki', () => {
  const convs = [...parseConversations(chatgpt), ...parseConversations(claude)];
  const mail = threads(parseMail(mbox));
  const plan = buildWiki(convs, mail, { keys: new Set(), titles: new Set(['Welcome to Atlas']) });

  it('creates conversation, email, person, topic and decision notes', () => {
    const kinds = plan.notes.map((n) => `${n.kind}:${n.title}`);
    expect(kinds).toContain('conversation:Planning the Lisbon trip');
    expect(kinds).toContain('conversation:Lisbon trip packing');
    expect(kinds).toContain('email:Lisbon flights ✈');
    expect(kinds).toContain('person:Anna Silva');
    expect(kinds).toContain('person:Bob, Jr.');
    expect(kinds).not.toContain('person:Me'); // the mailbox owner
    expect(kinds).toContain('topic:Lisbon trip');
    expect(plan.stats).toMatchObject({ conversations: 2, threads: 1, people: 2, decisions: 2 });
  });
  it('links everything so the wiki pages fill themselves', () => {
    const notes: Note[] = plan.notes.map((n, i) => ({ id: String(i), type: 'note', title: n.title, body: n.body, createdAt: 0, updatedAt: 0 }));
    const ix = buildIndex(notes);
    const id = (t: string) => notes.find((n) => n.title === t)!.id;
    const back = (t: string) => [...ix.backlinks.get(id(t))!].map((x) => notes[+x].title).sort();
    expect(back('Anna Silva')).toEqual(['Lisbon flights ✈']);
    expect(back('Lisbon trip')).toEqual(['Lisbon trip packing', 'Planning the Lisbon trip']);
    expect(back('Planning the Lisbon trip')).toContain('Decisions from chats and email');
    const email = notes.find((n) => n.title === 'Lisbon flights ✈')!;
    expect(email.body).toMatch(/^type:: email\ndate:: 2026-01-05\nwith:: \[\[Anna Silva\]\], \[\[Bob, Jr\.\]\]/);
  });
  it('skips what was imported before', () => {
    const again = buildWiki(convs, mail, { keys: new Set(['chat:cg-1', 'chat:cl-1', `thread:${mail[0].id}`]), titles: new Set() });
    expect(again.stats).toMatchObject({ conversations: 0, threads: 0, skipped: 3 });
  });
  it('keeps pasted headings and fields from breaking the note', () => {
    const tricky = buildWiki(
      [{ id: 'x', title: 'T', platform: 'Claude', created: null, messages: [{ role: 'user', text: '# Big\ntype:: hacked', time: null }] }],
      [],
      { keys: new Set(), titles: new Set() },
    );
    const body = tricky.notes[0].body;
    expect(body).not.toMatch(/^# Big$/m);
    expect(body).not.toMatch(/^type:: hacked$/m);
  });
});
