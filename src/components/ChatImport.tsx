import { useMemo, useState } from 'react';
import { unzipSync } from 'fflate';
import type { Atlas } from '../lib/useAtlas';
import { parseConversations, type Conversation } from '../lib/wiki/chats';
import { ownerCandidates, parseMail, threads as toThreads, type Email } from '../lib/wiki/mbox';
import { buildWiki } from '../lib/wiki/build';
import { parseFields } from '../lib/fields';

interface Props {
  atlas: Atlas;
  uniqueTitle: (base: string) => string;
  onDone: (items: { id: string; title: string; detail: string }[]) => void;
  onError: (e: string) => void;
}

const MAX_BYTES = 400 * 1024 * 1024;
const decoder = new TextDecoder();

/** Import ChatGPT/Claude exports and mailboxes as a linked personal wiki. */
export function ChatImport({ atlas, onDone, onError }: Props) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [people, setPeople] = useState(true);
  const [topics, setTopics] = useState(true);
  const [owner, setOwner] = useState('');
  const [busy, setBusy] = useState('');

  async function read(list: FileList) {
    onError('');
    const c: Conversation[] = [];
    const m: Email[] = [];
    const names: string[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) {
        onError(`“${f.name}” is over 400 MB. Export a smaller part (e.g. one Gmail label) and try again.`);
        continue;
      }
      setBusy(`Reading “${f.name}”…`);
      try {
        const entries: [string, string][] = [];
        if (/\.zip$/i.test(f.name)) {
          const unzipped = unzipSync(new Uint8Array(await f.arrayBuffer()), {
            filter: (e) => /(^|\/)conversations\.json$/i.test(e.name) || /\.(mbox|eml)$/i.test(e.name),
          });
          for (const [name, data] of Object.entries(unzipped)) entries.push([name, decoder.decode(data)]);
          if (!entries.length) throw new Error('No conversations.json, .mbox or .eml inside this ZIP.');
        } else {
          entries.push([f.name, await f.text()]);
        }
        for (const [name, text] of entries) {
          if (/\.json$/i.test(name)) c.push(...parseConversations(text));
          else m.push(...parseMail(text));
        }
        names.push(f.name);
      } catch (e) {
        onError(`Couldn't read “${f.name}”: ${(e as Error).message}`);
      }
    }
    setBusy('');
    setConvs((x) => [...x, ...c]);
    setEmails((x) => {
      const all = [...x, ...m];
      if (!owner) setOwner(ownerCandidates(all)[0] ?? '');
      return all;
    });
    setFiles((x) => [...x, ...names]);
  }

  const existing = useMemo(() => {
    const keys = new Set<string>();
    for (const n of atlas.notes) {
      for (const f of parseFields(n.body)) {
        if (f.key === 'chatid') keys.add(`chat:${f.value}`);
        if (f.key === 'thread') keys.add(`thread:${f.value}`);
      }
    }
    return { keys, titles: new Set(atlas.notes.map((n) => n.title)) };
  }, [atlas.notes]);

  const mail = useMemo(() => toThreads(emails), [emails]);
  const plan = useMemo(
    () => (convs.length || mail.length ? buildWiki(convs, mail, existing, { people, topics, owner }) : null),
    [convs, mail, existing, people, topics, owner],
  );
  const candidates = useMemo(() => ownerCandidates(emails), [emails]);

  function doImport() {
    if (!plan) return;
    const created = plan.notes.map((n) => {
      const note = atlas.add(n.title, n.body);
      return { id: note.id, title: note.title, kind: n.kind };
    });
    const hubs = created.filter((c) => c.kind === 'topic' || c.kind === 'decisions' || c.kind === 'person').slice(0, 12);
    onDone([
      ...hubs.map((h) => ({ id: h.id, title: h.title, detail: h.kind === 'topic' ? 'topic page' : h.kind === 'person' ? 'person page' : 'decisions found' })),
      { id: created[0].id, title: `${created.length} notes imported`, detail: `first: ${created[0].title}` },
    ]);
    setConvs([]);
    setEmails([]);
    setFiles([]);
  }

  return (
    <div>
      <p className="muted small">
        Turn your chat history and email into a wiki: a note per conversation, a page per person and per topic, and a list of
        decisions, all linked. Nothing leaves this device.
      </p>
      <ul className="muted small steps-inline">
        <li>
          <strong>ChatGPT:</strong> Settings → Data controls → Export data. You’ll get a ZIP by email.
        </li>
        <li>
          <strong>Claude:</strong> Settings → Privacy → Export data.
        </li>
        <li>
          <strong>Email:</strong> an .mbox file (Gmail: Google Takeout → Mail; Thunderbird and Apple Mail can export mailboxes) or .eml files.
        </li>
      </ul>
      <label className="btn file-btn">
        Choose export files…
        <input type="file" multiple accept=".zip,.json,.mbox,.eml,.txt" hidden onChange={(e) => e.target.files && void read(e.target.files).then(() => (e.target.value = ''))} />
      </label>
      {busy && (
        <p className="small" role="status">
          {busy}
        </p>
      )}
      {plan && (
        <div className="card preview">
          <p className="small muted">From {files.join(', ')}:</p>
          <ul className="stats">
            <li>
              <strong>{plan.stats.conversations}</strong> conversations
            </li>
            <li>
              <strong>{plan.stats.threads}</strong> email threads
            </li>
            <li>
              <strong>{plan.stats.people}</strong> people
            </li>
            <li>
              <strong>{plan.stats.topics}</strong> topics
            </li>
            <li>
              <strong>{plan.stats.decisions}</strong> decisions spotted
            </li>
          </ul>
          {plan.stats.skipped > 0 && <p className="muted small">{plan.stats.skipped} already imported before; they’ll be skipped.</p>}
          <label className="check small">
            <input type="checkbox" checked={topics} onChange={(e) => setTopics(e.target.checked)} /> Create topic pages
          </label>{' '}
          <label className="check small">
            <input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} /> Create pages for people I email
          </label>
          {emails.length > 0 && people && candidates.length > 0 && (
            <label className="field">
              <span>Your email address (you don’t get a page)</span>
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                {candidates.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!plan.notes.length} onClick={doImport}>
              Import {plan.notes.length} notes
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setConvs([]);
                setEmails([]);
                setFiles([]);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
