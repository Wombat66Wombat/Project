import { useEffect, useMemo, useRef, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Note } from '../lib/types';
import { normalizeTitle } from '../lib/links';
import { renderMarkdown } from '../lib/markdown';
import { navigate, noteHref } from '../lib/router';
import { LinkEditor } from './LinkEditor';
import type { Semantic } from '../lib/semantic/useSemantic';
import { KeySentences, SelectionToClaim } from './SourceTools';
import { MindMapView } from './MindMapView';
import { ArgumentView } from './ArgumentView';
import { LivePanel } from './LivePanel';
import { RecipeTools } from './RecipesView';
import { takeJustCreated } from '../lib/justCreated';
import type { Live } from '../lib/live/useLive';

type Mode = 'read' | 'edit' | 'map' | 'argue';
const MODES: [Mode, string, string][] = [
  ['read', 'Read', 'Read the note'],
  ['edit', 'Edit', 'Edit the text'],
  ['map', 'Map', 'See and edit the outline as a mind map'],
  ['argue', 'Argue', 'See how claims support and contradict each other'],
];

interface Props {
  atlas: Atlas;
  semantic: Semantic;
  live: Live;
  note: Note;
}

/** Add a [[link]] at the end of a body, on a "Related:" line. */
export function appendRelatedLink(body: string, title: string): string {
  const link = `[[${title}]]`;
  const lines = body.replace(/\s+$/, '').split('\n');
  const last = lines[lines.length - 1] ?? '';
  if (/^Related: /.test(last)) {
    lines[lines.length - 1] = `${last}, ${link}`;
    return lines.join('\n');
  }
  return body.trim() ? `${body.replace(/\s+$/, '')}\n\nRelated: ${link}` : `Related: ${link}`;
}

function relTime(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

export function NoteView({ atlas, semantic, live, note }: Props) {
  const { index, notes } = atlas;
  // Empty notes (e.g. just created from a link) open straight into editing.
  // …as do notes you just made with New (e.g. from a template), so you can fill them in.
  const [mode, setMode] = useState<Mode>(() => (takeJustCreated(note.id) || note.body.trim() === '' ? 'edit' : 'read'));
  const editing = mode === 'edit';
  const setEditing = (on: boolean) => setMode(on ? 'edit' : 'read');
  const kind = index.kinds.get(note.id) ?? 'note';
  const proseRef = useRef<HTMLDivElement>(null);
  /** All body edits go through live.edit, which also updates the shared document when the note is live. */
  const setBody = (body: string) => live.edit(note.id, body);
  const people = live.stateFor(note.id)?.people ?? [];
  useEffect(() => {
    if (mode === 'read') live.setWhere(note.id, 'reading');
  }, [mode, note.id, live]);
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [titleError, setTitleError] = useState('');

  useEffect(() => {
    setTitleDraft(note.title);
    setTitleError('');
  }, [note.id, note.title]);

  const html = useMemo(
    () => (mode === 'read' ? renderMarkdown(note.body, index.byTitle) : ''),
    [mode, note.body, index.byTitle],
  );

  const backlinks = [...(index.backlinks.get(note.id) ?? [])]
    .map((id) => index.byId.get(id)!)
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
  const outgoing = [...(index.outgoing.get(note.id) ?? [])].map((id) => index.byId.get(id)!).filter(Boolean);
  const missing = [...(index.unresolved.get(note.id) ?? [])];
  const related_ = semantic.related; // stable until the vectors change
  const related = useMemo(() => {
    const exclude = new Set([note.id, ...(index.outgoing.get(note.id) ?? []), ...(index.backlinks.get(note.id) ?? [])]);
    return related_(note.id, exclude).flatMap((h) => {
      const n = index.byId.get(h.id);
      return n ? [n] : [];
    });
  }, [related_, note.id, index]);

  function commitTitle() {
    const t = titleDraft.trim();
    if (!t) {
      setTitleDraft(note.title);
      setTitleError('');
      return;
    }
    if (t === note.title) return;
    const clash = notes.find((n) => n.id !== note.id && normalizeTitle(n.title) === normalizeTitle(t));
    if (clash) {
      setTitleError(`Another note is already called “${clash.title}”.`);
      return;
    }
    setTitleError('');
    atlas.rename(note.id, t);
  }

  function del() {
    const n = backlinks.length;
    const msg = n
      ? `Delete “${note.title}”? ${n} note${n === 1 ? ' links' : 's link'} to it; those links will show as missing.`
      : `Delete “${note.title}”?`;
    if (!confirm(msg)) return;
    live.leave(note.id);
    atlas.remove(note.id);
    navigate('#/', true);
  }

  return (
    <article className={`note ${mode === 'map' || mode === 'argue' ? 'wide' : ''}`}>
      <div className="note-toolbar">
        <a className="btn ghost back" href="#/" aria-label="Back to notes">
          ← Notes
        </a>
        <span className="muted small edited">Edited {relTime(note.updatedAt)}</span>
        <span className="spacer" />
        <LivePanel live={live} note={note} />
        <div className="segmented" role="group" aria-label="Mode">
          {MODES.map(([m, label, title]) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} title={title} onClick={() => setMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <button className="btn ghost danger" onClick={del} title="Delete note">
          Delete
        </button>
      </div>

      <input
        className="note-title"
        value={titleDraft}
        aria-label="Note title"
        placeholder="Untitled"
        onChange={(e) => setTitleDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setTitleDraft(note.title);
            setTitleError('');
          }
        }}
      />
      {titleError && <p className="error small">{titleError}</p>}

      {editing ? (
        <LinkEditor
          value={note.body}
          onChange={setBody}
          onCaret={(line) => live.setWhere(note.id, `editing line ${line}`)}
          people={people}
          notes={notes}
          selfId={note.id}
          autoFocus={note.body.trim() === ''}
        />
      ) : mode === 'map' ? (
        <MindMapView
          note={note}
          onChange={setBody}
          people={people}
          onSelect={(lbl) => live.setWhere(note.id, `map: ${lbl}`, lbl)}
        />
      ) : mode === 'argue' ? (
        <ArgumentView atlas={atlas} note={note} setBody={setBody} />
      ) : note.body.trim() ? (
        <div className="prose-wrap">
          <div ref={proseRef} className="prose" dangerouslySetInnerHTML={{ __html: html }} onDoubleClick={() => setEditing(true)} />
          {(kind === 'source' || kind === 'conversation' || kind === 'email') && <SelectionToClaim atlas={atlas} note={note} proseRef={proseRef} />}
        </div>
      ) : (
        <p className="muted">
          This note is empty. <button className="linklike" onClick={() => setEditing(true)}>Start writing</button>
        </p>
      )}

      {mode === 'read' && kind === 'source' && <KeySentences atlas={atlas} note={note} />}
      {mode === 'read' && kind === 'recipe' && <RecipeTools atlas={atlas} note={note} />}

      <footer className="connections">
        <section>
          <h2>Linked from {backlinks.length > 0 && <span className="count">{backlinks.length}</span>}</h2>
          {backlinks.length === 0 ? (
            <p className="muted small">No notes link here yet. Mention [[{note.title}]] in another note.</p>
          ) : (
            <ul className="chips">
              {backlinks.map((b) => (
                <li key={b.id}>
                  <a href={noteHref(b.id)}>{b.title}</a>
                </li>
              ))}
            </ul>
          )}
        </section>
        {outgoing.length > 0 && (
          <section>
            <h2>Links to <span className="count">{outgoing.length}</span></h2>
            <ul className="chips">
              {outgoing.map((o) => (
                <li key={o.id}>
                  <a href={noteHref(o.id)}>{o.title}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {related.length > 0 && (
          <section>
            <h2>
              Related <span className="muted small normal">· similar meaning, not linked yet</span>
            </h2>
            <ul className="chips">
              {related.map((r) => (
                <li key={r.id} className="related">
                  <a href={noteHref(r.id)}>{r.title}</a>
                  <button
                    className="chip-action"
                    title={`Add a link to “${r.title}” to this note`}
                    aria-label={`Link “${r.title}”`}
                    onClick={() => setBody(appendRelatedLink(note.body, r.title))}
                  >
                    + link
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {missing.length > 0 && (
          <section>
            <h2>Not written yet <span className="count">{missing.length}</span></h2>
            <ul className="chips">
              {missing.map((t) => (
                <li key={t}>
                  <a className="missing" href={`#/new/${encodeURIComponent(t)}`}>
                    + {t}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </footer>
    </article>
  );
}
