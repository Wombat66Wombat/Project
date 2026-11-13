import { useEffect, useMemo, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Note } from '../lib/types';
import { normalizeTitle } from '../lib/links';
import { renderMarkdown } from '../lib/markdown';
import { navigate, noteHref } from '../lib/router';
import { LinkEditor } from './LinkEditor';

interface Props {
  atlas: Atlas;
  note: Note;
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

export function NoteView({ atlas, note }: Props) {
  const { index, notes } = atlas;
  // Empty notes (e.g. just created from a link) open straight into editing.
  const [editing, setEditing] = useState(() => note.body.trim() === '');
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [titleError, setTitleError] = useState('');

  useEffect(() => {
    setTitleDraft(note.title);
    setTitleError('');
  }, [note.id, note.title]);

  const html = useMemo(
    () => (editing ? '' : renderMarkdown(note.body, index.byTitle)),
    [editing, note.body, index.byTitle],
  );

  const backlinks = [...(index.backlinks.get(note.id) ?? [])]
    .map((id) => index.byId.get(id)!)
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));
  const outgoing = [...(index.outgoing.get(note.id) ?? [])].map((id) => index.byId.get(id)!).filter(Boolean);
  const missing = [...(index.unresolved.get(note.id) ?? [])];

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
    atlas.remove(note.id);
    navigate('#/', true);
  }

  return (
    <article className="note">
      <div className="note-toolbar">
        <a className="btn ghost back" href="#/" aria-label="Back to notes">
          ← Notes
        </a>
        <span className="muted small edited">Edited {relTime(note.updatedAt)}</span>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Mode">
          <button className={!editing ? 'on' : ''} aria-pressed={!editing} onClick={() => setEditing(false)}>
            Read
          </button>
          <button className={editing ? 'on' : ''} aria-pressed={editing} onClick={() => setEditing(true)}>
            Edit
          </button>
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
          onChange={(body) => atlas.updateBody(note.id, body)}
          notes={notes}
          selfId={note.id}
          autoFocus={note.body.trim() === ''}
        />
      ) : note.body.trim() ? (
        <div className="prose" dangerouslySetInnerHTML={{ __html: html }} onDoubleClick={() => setEditing(true)} />
      ) : (
        <p className="muted">
          This note is empty. <button className="linklike" onClick={() => setEditing(true)}>Start writing</button>
        </p>
      )}

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
