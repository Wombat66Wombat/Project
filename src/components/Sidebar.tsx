import { useEffect, useMemo, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import { runSearch } from '../lib/search';
import { noteHref } from '../lib/router';
import type { Semantic } from '../lib/semantic/useSemantic';
import { chunkNote, fuse, type SemanticHit } from '../lib/semantic/core';

interface Props {
  atlas: Atlas;
  semantic: Semantic;
  query: string;
  activeId: string | null;
  onPick?: () => void;
  onSmartSearch: () => void;
}

/** The passage that matched by meaning, without its "Title: " prefix. */
function passage(text: string, title: string): string {
  const t = text.startsWith(`${title}: `) ? text.slice(title.length + 2) : text;
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

export function Sidebar({ atlas, semantic, query, activeId, onPick, onSmartSearch }: Props) {
  const { notes, search, index } = atlas;
  const textHits = useMemo(() => runSearch(search, query), [search, query]);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes]);

  // Meaning-based results arrive a moment later (the query is embedded in the worker).
  const smartOn = semantic.settings.enabled && (semantic.status === 'ready' || semantic.status === 'indexing');
  const [meaning, setMeaning] = useState<{ q: string; hits: SemanticHit[] }>({ q: '', hits: [] });
  useEffect(() => {
    const q = query.trim();
    if (!smartOn || !q) return setMeaning({ q: '', hits: [] });
    let alive = true;
    const t = setTimeout(() => {
      void semantic.search(q).then((hits) => alive && setMeaning({ q, hits }));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, smartOn, semantic.version, semantic.search]);

  const results = useMemo(() => {
    const sem = meaning.q === query.trim() ? meaning.hits : [];
    const byId = new Map(textHits.map((h) => [h.id, h]));
    return fuse(textHits, sem).flatMap((r) => {
      const note = index.byId.get(r.id);
      if (!note) return [];
      const text = byId.get(r.id);
      const snippet = text?.snippet || (r.byMeaning ? passage(chunkNote(note)[r.byMeaning.chunk] ?? '', note.title) : '');
      return [{ id: r.id, title: note.title, snippet, onlyMeaning: !r.byText }];
    });
  }, [textHits, meaning, query, index]);

  if (query.trim()) {
    const hits = results;
    return (
      <nav className="sidebar" aria-label="Search results">
        <p className="sidebar-label">
          {hits.length} result{hits.length === 1 ? '' : 's'}
          {smartOn && <span className="smart-badge" title="Also finding notes by meaning">✦ smart</span>}
        </p>
        <ul className="note-list">
          {hits.map((h) => (
            <li key={h.id}>
              <a href={noteHref(h.id)} className={h.id === activeId ? 'active' : ''} onClick={onPick}>
                <span className="note-list-title">
                  {h.title || 'Untitled'}
                  {h.onlyMeaning && <span className="meaning-tag">similar meaning</span>}
                </span>
                {h.snippet && <span className="note-list-snippet">{h.snippet}</span>}
              </a>
            </li>
          ))}
        </ul>
        {hits.length === 0 && (
          <p className="muted small pad">
            Nothing matches. <a href={`#/new/${encodeURIComponent(query.trim())}`}>Create “{query.trim()}”</a>
          </p>
        )}
        {!semantic.settings.enabled && (
          <p className="muted small pad hint">
            Tip:{' '}
            <button className="linklike" onClick={onSmartSearch}>
              turn on smart search
            </button>{' '}
            to also find notes by meaning, not just exact words.
          </p>
        )}
      </nav>
    );
  }

  return (
    <nav className="sidebar" aria-label="Notes">
      <p className="sidebar-label">
        {notes.length} note{notes.length === 1 ? '' : 's'}
      </p>
      <ul className="note-list">
        {recent.map((n) => {
          const links = (index.backlinks.get(n.id)?.size ?? 0) + (index.outgoing.get(n.id)?.size ?? 0);
          return (
            <li key={n.id}>
              <a href={noteHref(n.id)} className={n.id === activeId ? 'active' : ''}>
                <span className="note-list-title">{n.title || 'Untitled'}</span>
                <span className="note-list-meta">
                  {links} link{links === 1 ? '' : 's'}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
