import { useEffect, useRef, useState } from 'react';
import { useAtlas } from './lib/useAtlas';
import { navigate, noteHref, useRoute } from './lib/router';
import { normalizeTitle } from './lib/links';
import { exportJson, parseNotes } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { NoteView } from './components/NoteView';
import { GraphView } from './components/GraphView';

export function App() {
  const atlas = useAtlas();
  const route = useRoute();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // #/new/<title>: open the note with that title, creating it if needed.
  useEffect(() => {
    if (route.name !== 'new') return;
    const existing = atlas.index.byTitle.get(normalizeTitle(route.title));
    if (existing) navigate(noteHref(existing.id), true);
    else atlas.ensure(route.title);
  }, [route, atlas.index, atlas.ensure]);

  // Ctrl/Cmd+K or "/" focuses search.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  function newNote() {
    let title = 'Untitled';
    for (let i = 2; atlas.index.byTitle.has(normalizeTitle(title)); i++) title = `Untitled ${i}`;
    const n = atlas.add(title);
    setQuery('');
    navigate(noteHref(n.id));
  }

  function doExport() {
    setMenuOpen(false);
    const blob = new Blob([exportJson(atlas.notes)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `atlas-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function doImport(file: File) {
    try {
      const incoming = parseNotes(await file.text());
      if (!confirm(`Replace your ${atlas.notes.length} notes with ${incoming.length} notes from “${file.name}”?`)) return;
      atlas.replaceAll(incoming);
      navigate('#/', true);
    } catch (err) {
      alert(`Couldn't import that file: ${(err as Error).message}`);
    }
  }

  const activeNote = route.name === 'note' ? atlas.index.byId.get(route.id) ?? null : null;
  const view = route.name === 'graph' ? 'graph' : activeNote ? 'note' : 'home';

  return (
    <div className="app" data-view={view} data-searching={query.trim() ? 'true' : undefined}>
      <header className="topbar">
        <a href="#/" className="brand" aria-label="Atlas home">
          <img src="favicon.svg" alt="" width="22" height="22" />
          <span>Atlas</span>
        </a>
        <div className="search">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search notes  ⌘K"
            aria-label="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          />
        </div>
        <nav className="top-actions">
          <a className={`btn ghost ${route.name === 'graph' ? 'on' : ''}`} href="#/graph">
            Graph
          </a>
          <button className="btn primary" onClick={newNote}>
            + New
          </button>
          <div className="menu">
            <button
              className="btn ghost icon"
              aria-label="More"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="menu-pop" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                <button role="menuitem" onClick={doExport}>
                  Export backup (.json)
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    fileRef.current?.click();
                  }}
                >
                  Import backup…
                </button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void doImport(f);
                e.target.value = '';
              }}
            />
          </div>
        </nav>
      </header>

      <div className="body">
        <Sidebar
          atlas={atlas}
          query={query}
          activeId={activeNote?.id ?? null}
          // On phones the results list covers the note, so close it once a result is picked.
          onPick={() => window.matchMedia('(max-width: 760px)').matches && setQuery('')}
        />
        <main className="main">
          {view === 'graph' && <GraphView notes={atlas.notes} index={atlas.index} />}
          {view === 'note' && activeNote && <NoteView key={activeNote.id} atlas={atlas} note={activeNote} />}
          {view === 'home' && (
            <div className="home">
              {route.name === 'note' ? (
                <p className="muted">That note doesn't exist any more.</p>
              ) : (
                <>
                  <h1>Your atlas</h1>
                  <p className="muted">
                    {atlas.notes.length} notes ·{' '}
                    {[...atlas.index.outgoing.values()].reduce((s, v) => s + v.size, 0)} links
                  </p>
                </>
              )}
              <div className="home-actions">
                <button className="btn primary" onClick={newNote}>
                  + New note
                </button>
                <a className="btn" href="#/graph">
                  Open graph
                </a>
              </div>
            </div>
          )}
        </main>
      </div>

      <div className={`save-state ${atlas.saveState}`} role="status" aria-live="polite">
        {atlas.saveState === 'error' ? "Couldn't save — export a backup" : atlas.saveState === 'saving' ? 'Saving…' : 'Saved'}
      </div>
    </div>
  );
}
