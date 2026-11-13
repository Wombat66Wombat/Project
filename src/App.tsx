import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useAtlas } from './lib/useAtlas';
import { navigate, noteHref, useRoute, type ViewName } from './lib/router';
import { normalizeTitle } from './lib/links';
import { exportJson, parseNotes } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { NoteView } from './components/NoteView';
import { GraphView } from './components/GraphView';
import { SyncDialog, relTime } from './components/SyncDialog';
import { useSync } from './lib/useSync';
import { useSemantic } from './lib/semantic/useSemantic';
import { SmartSearchDialog } from './components/SmartSearchDialog';
import { Menu } from './components/Menu';
import { decisionTemplate, pantryTemplate, recipeTemplate, claimTemplate } from './lib/templates';
import { AskView } from './components/AskView';
import { DecisionsView } from './components/DecisionsView';
import { RecipesView } from './components/RecipesView';
import { useLive } from './lib/live/useLive';

// The 3D city pulls in three.js (~600 kB), so it loads only when opened.
const CityView = lazy(() => import('./components/CityView'));
// Importers bring Readability and the chat parsers; load them when the Import screen opens.
const ImportView = lazy(() => import('./components/ImportView').then((m) => ({ default: m.ImportView })));

const VIEW_LABELS: Record<ViewName, string> = {
  graph: 'Graph',
  city: 'City',
  ask: 'Ask',
  decisions: 'Decisions',
  recipes: 'Recipes',
  import: 'Import',
};

export function App() {
  const atlas = useAtlas();
  const sync = useSync(atlas);
  const semantic = useSemantic(atlas);
  const live = useLive(atlas);
  const [smartOpen, setSmartOpen] = useState(false);
  const route = useRoute();
  const [syncOpen, setSyncOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  // When another tab takes over, make this one fully non-interactive (no typing behind the overlay).
  useEffect(() => {
    shellRef.current?.toggleAttribute('inert', atlas.inactive);
    if (atlas.inactive && document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }, [atlas.inactive]);

  // #/new/<title>: open the note with that title, creating it if needed.
  useEffect(() => {
    if (route.name !== 'new' || !atlas.ready) return;
    const existing = atlas.index.byTitle.get(normalizeTitle(route.title));
    if (existing) navigate(noteHref(existing.id), true);
    else atlas.ensure(route.title);
  }, [route, atlas.ready, atlas.index, atlas.ensure]);

  // #/live/<room>/<title>: open an invite (creating the shared note on this device if needed).
  useEffect(() => {
    if (route.name !== 'live' || !atlas.ready || atlas.inactive) return;
    let cancelled = false;
    void live.join(route.room, route.title).then((id) => !cancelled && navigate(noteHref(id), true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, atlas.ready, atlas.inactive]);

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

  function uniqueTitle(base: string): string {
    let title = base;
    for (let i = 2; atlas.index.byTitle.has(normalizeTitle(title)); i++) title = `${base} ${i}`;
    return title;
  }

  function newNote(base = 'Untitled', body = '') {
    const n = atlas.add(uniqueTitle(base), body);
    setQuery('');
    navigate(noteHref(n.id));
  }

  function doExport() {
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
  const screen = route.name in VIEW_LABELS ? (route.name as ViewName) : null;
  const view = screen ? 'screen' : activeNote ? 'note' : 'home';

  return (
    <div className="app" data-view={view} data-searching={query.trim() ? 'true' : undefined}>
      <div className="shell" ref={shellRef}>
        <header className="topbar">
          <a href="#/" className="brand" aria-label="Atlas home">
            <img src="favicon.svg" alt="" width="22" height="22" />
            <span>Atlas</span>
          </a>
          <div className="search">
            <input
              ref={searchRef}
              type="search"
              placeholder={semantic.settings.enabled ? 'Search by words or meaning  ⌘K' : 'Search notes  ⌘K'}
              aria-label="Search notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            />
          </div>
          <nav className="top-actions">
            <button
              className={`btn ghost sync-chip ${sync.status}`}
              onClick={() => setSyncOpen(true)}
              aria-label={sync.status === 'off' ? 'Sync with GitHub' : `Sync status: ${sync.status}`}
              title={sync.config ? `${sync.config.repo}: ${sync.error ?? `synced ${relTime(sync.lastSyncAt)}`}` : 'Sync with GitHub'}
            >
              <span className="dot" aria-hidden="true" />
              <span className="sync-label">
                {sync.status === 'off' && 'Sync'}
                {sync.status === 'syncing' && 'Syncing…'}
                {sync.status === 'synced' && 'Synced'}
                {sync.status === 'offline' && 'Offline'}
                {sync.status === 'error' && 'Sync error'}
              </span>
            </button>
            <Menu
              ariaLabel="Views"
              label={<>{screen ? VIEW_LABELS[screen] : 'Views'} ▾</>}
              className={`btn ghost ${screen ? 'on' : ''}`}
              items={[
                { label: 'Graph', hint: 'how notes connect', onSelect: () => navigate('#/graph') },
                { label: 'City', hint: 'your notes in 3D', onSelect: () => navigate('#/city') },
                { label: 'Ask', hint: 'answers with sources', onSelect: () => navigate('#/ask') },
                'separator',
                { label: 'Decisions', hint: 'journal & calibration', onSelect: () => navigate('#/decisions') },
                { label: 'Recipes', hint: 'what can I cook?', onSelect: () => navigate('#/recipes') },
                'separator',
                { label: 'Import…', hint: 'PDFs, articles, chats', onSelect: () => navigate('#/import') },
              ]}
            />
            <div className="split">
              <button className="btn primary" onClick={() => newNote()}>
                + New
              </button>
              <Menu
                ariaLabel="New from template"
                label="▾"
                className="btn primary split-caret"
                items={[
                  { label: 'Note', onSelect: () => newNote() },
                  { label: 'Decision', hint: 'with a prediction to review', onSelect: () => newNote('Decision', decisionTemplate()) },
                  { label: 'Claim', hint: 'for argument maps', onSelect: () => newNote('Claim', claimTemplate()) },
                  { label: 'Recipe', onSelect: () => newNote('Recipe', recipeTemplate()) },
                  {
                    label: 'Pantry',
                    hint: "what's in your kitchen",
                    onSelect: () => {
                      const existing = atlas.notes.find((n) => atlas.index.kinds.get(n.id) === 'pantry');
                      if (existing) navigate(noteHref(existing.id));
                      else newNote('Pantry', pantryTemplate());
                    },
                  },
                ]}
              />
            </div>
            <Menu
              ariaLabel="More"
              label="⋯"
              className="btn ghost icon"
              items={[
                { label: 'Sync with GitHub…', onSelect: () => setSyncOpen(true) },
                { label: 'Smart search…', onSelect: () => setSmartOpen(true) },
                { label: 'Import PDFs, articles, chats…', onSelect: () => navigate('#/import') },
                'separator',
                { label: 'Export backup (.json)', onSelect: doExport },
                { label: 'Restore backup…', onSelect: () => fileRef.current?.click() },
              ]}
            />
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
          </nav>
        </header>

        {sync.notices.length > 0 && (
          <div className="notice" role="status">
            <div>
              {sync.notices.map((n) => (
                <p key={n}>{n}</p>
              ))}
            </div>
            <button className="btn ghost icon" aria-label="Dismiss" onClick={sync.dismissNotices}>
              ×
            </button>
          </div>
        )}

        <div className="body">
          <Sidebar
            atlas={atlas}
            semantic={semantic}
            onSmartSearch={() => setSmartOpen(true)}
            query={query}
            activeId={activeNote?.id ?? null}
            // On phones the results list covers the note, so close it once a result is picked.
            onPick={() => window.matchMedia('(max-width: 760px)').matches && setQuery('')}
          />
          <main className="main">
            {!atlas.ready && <p className="muted loading">Loading your notes…</p>}
            {atlas.ready && screen === 'graph' && <GraphView notes={atlas.notes} index={atlas.index} />}
            {atlas.ready && screen === 'city' && (
              <Suspense fallback={<p className="muted loading">Building your city…</p>}>
                <CityView notes={atlas.notes} index={atlas.index} />
              </Suspense>
            )}
            {atlas.ready && screen === 'ask' && <AskView atlas={atlas} semantic={semantic} onSmartSearch={() => setSmartOpen(true)} />}
            {atlas.ready && screen === 'decisions' && <DecisionsView atlas={atlas} onNew={() => newNote('Decision', decisionTemplate())} />}
            {atlas.ready && screen === 'recipes' && (
              <RecipesView atlas={atlas} onNew={() => newNote('Recipe', recipeTemplate())} onNewPantry={() => newNote('Pantry', pantryTemplate())} />
            )}
            {atlas.ready && screen === 'import' && (
              <Suspense fallback={<p className="muted loading">Loading…</p>}>
                <ImportView atlas={atlas} uniqueTitle={uniqueTitle} />
              </Suspense>
            )}
            {atlas.ready && view === 'note' && activeNote && (
              <NoteView key={activeNote.id} atlas={atlas} semantic={semantic} live={live} note={activeNote} />
            )}
            {atlas.ready && view === 'home' && (
              <div className="home">
                {route.name === 'note' ? (
                  <p className="muted">That note doesn't exist any more.</p>
                ) : (
                  <>
                    <h1>Your atlas</h1>
                    <p className="muted">
                      {atlas.notes.length} notes · {[...atlas.index.outgoing.values()].reduce((s, v) => s + v.size, 0)} links
                    </p>
                  </>
                )}
                <div className="home-actions">
                  <button className="btn primary" onClick={() => newNote()}>
                    + New note
                  </button>
                  <a className="btn" href="#/graph">
                    Open graph
                  </a>
                  <a className="btn" href="#/import">
                    Import
                  </a>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {atlas.inactive && (
        <div className="takeover" role="alertdialog" aria-labelledby="takeover-title">
          <div className="takeover-card">
            <h2 id="takeover-title">Atlas is open in another tab</h2>
            <p className="muted">To keep your notes safe, only one tab can edit at a time. Your changes here were saved.</p>
            <button className="btn primary" onClick={() => location.reload()}>
              Use Atlas here
            </button>
          </div>
        </div>
      )}

      {smartOpen && <SmartSearchDialog semantic={semantic} onClose={() => setSmartOpen(false)} />}
      {syncOpen && <SyncDialog sync={sync} onClose={() => setSyncOpen(false)} />}

      <div className={`save-state ${atlas.saveState}`} role="status" aria-live="polite">
        {atlas.saveState === 'error' ? "Couldn't save — export a backup" : atlas.saveState === 'saving' ? 'Saving…' : 'Saved'}
      </div>
    </div>
  );
}
