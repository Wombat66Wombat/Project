import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from './types';
import { buildIndex, normalizeTitle, renameLinks } from './links';
import { buildSearch } from './search';
import { createNote, loadStored, saveStored, type Tombstone } from './store';

export type SaveState = 'saved' | 'saving' | 'error';

/** The parts of a sync result that change local notes. */
export interface SyncApply {
  /** The notes as they were when the sync started. */
  snapshot: Note[];
  upserts: Note[];
  removes: string[];
  clearedTombstones: string[];
}

/** All app state: the notes, the derived link graph and search index, and the actions that change them. */
export function useAtlas() {
  const [notes, setNotesState] = useState<Note[]>([]);
  const [tombstones, setTombstonesState] = useState<Tombstone[]>([]);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  // Refs hold the latest values so callbacks and sync can read them without re-subscribing.
  const notesRef = useRef(notes);
  const tombRef = useRef(tombstones);

  const setNotes = useCallback((next: Note[]) => {
    notesRef.current = next;
    setNotesState(next);
  }, []);
  const setTombstones = useCallback((next: Tombstone[]) => {
    tombRef.current = next;
    setTombstonesState(next);
  }, []);

  useEffect(() => {
    let alive = true;
    void loadStored().then((s) => {
      if (!alive) return;
      setNotes(s.notes);
      setTombstones(s.tombstones);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [setNotes, setTombstones]);

  // Debounced save to IndexedDB, plus a final flush when the tab is hidden or closed.
  useEffect(() => {
    if (!ready) return;
    setSaveState('saving');
    const t = setTimeout(() => {
      void saveStored({ notes, tombstones }).then((ok) => setSaveState(ok ? 'saved' : 'error'));
    }, 300);
    return () => clearTimeout(t);
  }, [notes, tombstones, ready]);
  useEffect(() => {
    if (!ready) return;
    const flush = () => void saveStored({ notes: notesRef.current, tombstones: tombRef.current });
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [ready]);

  const index = useMemo(() => buildIndex(notes), [notes]);
  // The search index is rebuilt off the typing path so editing stays snappy.
  const deferredNotes = useDeferredValue(notes);
  const search = useMemo(() => buildSearch(deferredNotes), [deferredNotes]);

  const add = useCallback(
    (title: string, body = ''): Note => {
      const note = createNote(title, body);
      setNotes([...notesRef.current, note]);
      return note;
    },
    [setNotes],
  );

  /** Create a note for `title` unless one exists (safe to call repeatedly). */
  const ensure = useCallback(
    (title: string) => {
      const key = normalizeTitle(title);
      if (notesRef.current.some((n) => normalizeTitle(n.title) === key)) return;
      setNotes([...notesRef.current, createNote(title.trim())]);
    },
    [setNotes],
  );

  const updateBody = useCallback(
    (id: string, body: string) => {
      setNotes(notesRef.current.map((n) => (n.id === id ? { ...n, body, updatedAt: Date.now() } : n)));
    },
    [setNotes],
  );

  /** Rename a note and rewrite every [[link]] that pointed at the old title. */
  const rename = useCallback(
    (id: string, title: string) => {
      const prev = notesRef.current;
      const target = prev.find((n) => n.id === id);
      if (!target) return;
      const oldTitle = target.title;
      const now = Date.now();
      setNotes(
        prev.map((n) => {
          if (n.id === id) return { ...n, title, body: renameLinks(n.body, oldTitle, title), updatedAt: now };
          // Rewriting a link isn't an edit by the user, so keep the note's updatedAt.
          const body = renameLinks(n.body, oldTitle, title);
          return body === n.body ? n : { ...n, body };
        }),
      );
    },
    [setNotes],
  );

  const remove = useCallback(
    (id: string) => {
      setNotes(notesRef.current.filter((n) => n.id !== id));
      setTombstones([...tombRef.current.filter((t) => t.id !== id), { id, deletedAt: Date.now() }]);
    },
    [setNotes, setTombstones],
  );

  /** Replace everything (backup import). Notes that disappear count as deleted, so sync removes them too. */
  const replaceAll = useCallback(
    (next: Note[]) => {
      const keep = new Set(next.map((n) => n.id));
      const gone = notesRef.current.filter((n) => !keep.has(n.id)).map((n) => ({ id: n.id, deletedAt: Date.now() }));
      setNotes(next);
      setTombstones([...tombRef.current.filter((t) => !keep.has(t.id)), ...gone]);
    },
    [setNotes, setTombstones],
  );

  /**
   * Apply a sync result. Notes edited while the sync was running are left alone;
   * their ids are returned so the caller keeps the old base and the next sync merges them.
   */
  const applySync = useCallback(
    (r: SyncApply): Set<string> => {
      const before = new Map(r.snapshot.map((n) => [n.id, n]));
      const current = new Map(notesRef.current.map((n) => [n.id, n]));
      const skipped = new Set<string>();
      const touchedDuringSync = (id: string) => {
        const was = before.get(id);
        const now = current.get(id);
        return !!now && (!was || was.updatedAt !== now.updatedAt || was.title !== now.title || was.body !== now.body);
      };
      for (const n of r.upserts) {
        if (touchedDuringSync(n.id)) skipped.add(n.id);
        else current.set(n.id, n);
      }
      for (const id of r.removes) {
        if (touchedDuringSync(id)) skipped.add(id);
        else current.delete(id);
      }
      // A note deleted while syncing stays deleted and keeps its tombstone, so the next sync deletes it on GitHub.
      const deletedDuringSync = new Set(tombRef.current.filter((t) => before.has(t.id)).map((t) => t.id));
      const cleared = new Set(r.clearedTombstones.filter((id) => !deletedDuringSync.has(id)));
      for (const id of deletedDuringSync) current.delete(id);
      setNotes([...current.values()]);
      setTombstones(tombRef.current.filter((t) => !cleared.has(t.id)));
      return skipped;
    },
    [setNotes, setTombstones],
  );

  const getState = useCallback(() => ({ notes: notesRef.current, tombstones: tombRef.current }), []);

  return { ready, notes, index, search, saveState, add, ensure, updateBody, rename, remove, replaceAll, applySync, getState };
}

export type Atlas = ReturnType<typeof useAtlas>;
