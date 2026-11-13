import { useMemo } from 'react';
import type { Atlas } from '../lib/useAtlas';
import { runSearch } from '../lib/search';
import { noteHref } from '../lib/router';

interface Props {
  atlas: Atlas;
  query: string;
  activeId: string | null;
  onPick?: () => void;
}

export function Sidebar({ atlas, query, activeId, onPick }: Props) {
  const { notes, search, index } = atlas;
  const hits = useMemo(() => runSearch(search, query), [search, query]);
  const recent = useMemo(() => [...notes].sort((a, b) => b.updatedAt - a.updatedAt), [notes]);

  if (query.trim()) {
    return (
      <nav className="sidebar" aria-label="Search results">
        <p className="sidebar-label">
          {hits.length} result{hits.length === 1 ? '' : 's'}
        </p>
        <ul className="note-list">
          {hits.map((h) => (
            <li key={h.id}>
              <a href={noteHref(h.id)} className={h.id === activeId ? 'active' : ''} onClick={onPick}>
                <span className="note-list-title">{h.title || 'Untitled'}</span>
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
