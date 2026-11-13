import { useMemo, useState } from 'react';
import MiniSearch from 'minisearch';
import type { Atlas } from '../lib/useAtlas';
import type { Semantic } from '../lib/semantic/useSemantic';
import { notePassages } from '../lib/research/passages';
import { citeLabel, claimFromQuote } from '../lib/research/source';
import { uniqueTitle } from '../lib/links';
import { noteHref } from '../lib/router';

interface Props {
  atlas: Atlas;
  semantic: Semantic;
  onSmartSearch: () => void;
}

interface Answer {
  noteId: string;
  title: string;
  text: string;
  section: string;
  kind: string;
}

/** Highlight the question's words in a passage (safely: text is split, never parsed as HTML). */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return (
    <>
      {text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

/**
 * Ask a question; get the passages from your notes and sources that answer it, each with a
 * citation (source, page or timestamp). Uses smart search when it's on, keywords otherwise.
 */
export function AskView({ atlas, semantic, onSmartSearch }: Props) {
  const [q, setQ] = useState('');
  const [onlySources, setOnlySources] = useState(false);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const smart = semantic.settings.enabled && (semantic.status === 'ready' || semantic.status === 'indexing');

  // Keyword fallback: an index of every passage.
  const keywordIndex = useMemo(() => {
    const ms = new MiniSearch<{ id: string; text: string; section: string }>({
      fields: ['text', 'section'],
      storeFields: ['text'],
      searchOptions: { prefix: true, fuzzy: 0.2, combineWith: 'OR', boost: { section: 0.5 } },
    });
    for (const n of atlas.notes) notePassages(n).forEach((p, i) => ms.add({ id: `${n.id}#${i}`, text: p.text, section: p.section }));
    return ms;
  }, [atlas.notes]);

  async function ask(e?: React.FormEvent) {
    e?.preventDefault();
    const question = q.trim();
    if (!question) return;
    setBusy(true);
    const kindOf = (id: string) => atlas.index.kinds.get(id) ?? 'note';
    const pick = (noteId: string, i: number): Answer | null => {
      const note = atlas.index.byId.get(noteId);
      const p = note && notePassages(note)[i];
      return note && p ? { noteId, title: note.title, text: p.text, section: p.section, kind: kindOf(noteId) } : null;
    };
    let out: Answer[] = [];
    if (smart) {
      const hits = await semantic.searchPassages(question);
      out = hits.map((h) => pick(h.id, h.chunk)).filter((a): a is Answer => !!a);
    }
    if (out.length === 0) {
      const hits = keywordIndex.search(question);
      const best = hits[0]?.score ?? 0;
      out = hits
        .filter((r) => r.score >= best * 0.35) // keep answers reasonably close to the best match
        .slice(0, 8)
        .map((r) => {
          const [noteId, i] = String(r.id).split('#');
          return pick(noteId, +i);
        })
        .filter((a): a is Answer => !!a);
    }
    if (onlySources) out = out.filter((a) => a.kind === 'source' || a.kind === 'claim');
    setAnswers(out);
    setAsked(question);
    setBusy(false);
  }

  function saveClaim(a: Answer) {
    const c = claimFromQuote(a.text, a.title, a.section);
    const n = atlas.add(uniqueTitle(atlas.index.byTitle, c.title), c.body);
    setSaved((s) => ({ ...s, [`${a.noteId}|${a.text}`]: n.id }));
  }

  const terms = asked
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 3);

  return (
    <section className="screen">
      <h1>Ask</h1>
      <p className="muted">Ask a question. Atlas finds the passages in your notes and sources that answer it, with where each one comes from.</p>
      <form className="ask-form" onSubmit={ask}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. How does sleep affect memory?"
          aria-label="Your question"
          autoFocus
        />
        <button className="btn primary" disabled={busy || !q.trim()}>
          {busy ? 'Looking…' : 'Ask'}
        </button>
      </form>
      <label className="check small">
        <input type="checkbox" checked={onlySources} onChange={(e) => setOnlySources(e.target.checked)} /> Only imported sources and claims
      </label>
      {!smart && (
        <p className="muted small">
          Matching by keywords.{' '}
          <button className="linklike" onClick={onSmartSearch}>
            Turn on smart search
          </button>{' '}
          to find answers that use different words.
        </p>
      )}

      {answers && answers.length === 0 && (
        <div className="empty muted">
          Nothing in your notes answers “{asked}” yet. <a href="#/import">Import a source</a> to add knowledge.
        </div>
      )}
      {answers && answers.length > 0 && (
        <ol className="answers">
          {answers.map((a, i) => {
            const key = `${a.noteId}|${a.text}`;
            return (
              <li key={i} className="card answer">
                <blockquote>
                  <Highlight text={a.text} terms={terms} />
                </blockquote>
                <div className="cite">
                  — <a href={noteHref(a.noteId)}>{a.title}</a>
                  {a.section && <span className="muted">, {citeLabel(a.section)}</span>}
                  {a.kind !== 'note' && <span className="kind-tag">{a.kind}</span>}
                  <span className="spacer" />
                  {saved[key] ? (
                    <a href={noteHref(saved[key])} className="small">
                      Saved ✓ open claim
                    </a>
                  ) : (
                    <button className="btn ghost small-btn" onClick={() => saveClaim(a)}>
                      Save as claim
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
