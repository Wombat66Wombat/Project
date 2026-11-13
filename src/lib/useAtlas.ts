import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { Note } from './types';
import { buildIndex, normalizeTitle, renameLinks } from './links';
import { buildSearch } from './search';
import { createNote, loadNotes, saveNotes } from './store';

export type SaveState = 'saved' | 'saving' | 'error';

/** All app state: the notes, the derived link graph and search index, and the actions that change them. */
export function useAtlas() {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const latest = useRef(notes);
  latest.current = notes;

  // Debounced save to browser storage, plus a final flush when the tab is hidden or closed.
  useEffect(() => {
    setSaveState('saving');
    const t = setTimeout(() => setSaveState(saveNotes(notes) ? 'saved' : 'error'), 300);
    return () => clearTimeout(t);
  }, [notes]);
  useEffect(() => {
    const flush = () => saveNotes(latest.current);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

  const index = useMemo(() => buildIndex(notes), [notes]);
  // The search index is rebuilt off the typing path so editing stays snappy.
  const deferredNotes = useDeferredValue(notes);
  const search = useMemo(() => buildSearch(deferredNotes), [deferredNotes]);

  const add = useCallback((title: string, body = ''): Note => {
    const note = createNote(title, body);
    setNotes((prev) => [...prev, note]);
    return note;
  }, []);

  /** Create a note for `title` unless one exists (safe to call repeatedly). */
  const ensure = useCallback((title: string) => {
    const key = normalizeTitle(title);
    setNotes((prev) => (prev.some((n) => normalizeTitle(n.title) === key) ? prev : [...prev, createNote(title.trim())]));
  }, []);

  const updateBody = useCallback((id: string, body: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, body, updatedAt: Date.now() } : n)));
  }, []);

  /** Rename a note and rewrite every [[link]] that pointed at the old title. */
  const rename = useCallback((id: string, title: string) => {
    setNotes((prev) => {
      const target = prev.find((n) => n.id === id);
      if (!target) return prev;
      const oldTitle = target.title;
      const now = Date.now();
      return prev.map((n) => {
        if (n.id === id) return { ...n, title, body: renameLinks(n.body, oldTitle, title), updatedAt: now };
        // Rewriting a link isn't an edit by the user, so keep the note's updatedAt.
        const body = renameLinks(n.body, oldTitle, title);
        return body === n.body ? n : { ...n, body };
      });
    });
  }, []);

  const remove = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const replaceAll = useCallback((next: Note[]) => setNotes(next), []);

  return { notes, index, search, saveState, add, ensure, updateBody, rename, remove, replaceAll };
}

export type Atlas = ReturnType<typeof useAtlas>;
