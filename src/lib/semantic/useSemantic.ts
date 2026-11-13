import { useCallback, useEffect, useRef, useState } from 'react';
import type { Atlas } from '../useAtlas';
import { dbDelete, dbGet, dbSet } from '../db';
import { chunkNote, noteHash, relatedNotes, semanticSearch, type NoteVectors, type SemanticHit, type VectorStore } from './core';
import { DIMS, MODELS, type ModelKey } from './models';
import type { WorkerIn, WorkerOut } from './worker';

export type SemanticStatus = 'off' | 'loading' | 'indexing' | 'ready' | 'error';

interface Settings {
  enabled: boolean;
  model: ModelKey;
}

export interface SemanticInfo {
  status: SemanticStatus;
  settings: Settings;
  /** Model download progress in bytes (while loading). */
  download: { loaded: number; total: number } | null;
  /** Notes indexed so far / notes in total. */
  indexed: number;
  total: number;
  error: string | null;
  /** Bumps whenever the stored vectors change, so views can recompute. */
  version: number;
}

const SETTINGS_KEY = 'semanticSettings';
const storeKey = (m: ModelKey) => `semantic:v1:${m}`;

function validStore(raw: unknown): VectorStore {
  const out: VectorStore = new Map();
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, e] of Object.entries(raw as Record<string, NoteVectors>)) {
    if (e && typeof e.h === 'string' && e.v instanceof Float32Array && e.v.length > 0 && e.v.length % DIMS === 0) out.set(id, e);
  }
  return out;
}

/** Smart search: an embedding model running in a web worker, with vectors kept in IndexedDB. */
export function useSemantic(atlas: Atlas) {
  const [info, setInfo] = useState<SemanticInfo>({
    status: 'off',
    settings: { enabled: false, model: 'en' },
    download: null,
    indexed: 0,
    total: 0,
    error: null,
    version: 0,
  });
  const [loaded, setLoaded] = useState(false);
  const store = useRef<VectorStore>(new Map());
  const worker = useRef<Worker | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const pending = useRef(new Map<number, { resolve: (v: Float32Array) => void; reject: (e: Error) => void }>());
  const nextId = useRef(1);
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  const indexing = useRef(false);
  const indexAgain = useRef(false);
  const generation = useRef(0); // bumps on enable/disable/model switch, cancelling stale work
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { enabled, model: modelKey } = info.settings;
  const model = MODELS[modelKey];

  useEffect(() => {
    void dbGet<Settings>(SETTINGS_KEY).then((s) => {
      if (s && (s.model === 'en' || s.model === 'multi')) setInfo((i) => ({ ...i, settings: { enabled: !!s.enabled, model: s.model } }));
      setLoaded(true);
    });
  }, []);

  const stopWorker = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    ready.current = null;
    for (const p of pending.current.values()) p.reject(new Error('stopped'));
    pending.current.clear();
  }, []);

  const startWorker = useCallback(
    (modelId: string) => {
      stopWorker();
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.current = w;
      ready.current = new Promise<void>((resolve, reject) => {
        w.onmessage = (e: MessageEvent<WorkerOut>) => {
          const m = e.data;
          if (m.type === 'progress') setInfo((i) => ({ ...i, download: { loaded: m.loaded, total: m.total } }));
          else if (m.type === 'ready') resolve();
          else if (m.type === 'vectors') {
            pending.current.get(m.id)?.resolve(m.data);
            pending.current.delete(m.id);
          } else if (m.type === 'error') {
            if (m.id === undefined) reject(new Error(m.message));
            else {
              pending.current.get(m.id)?.reject(new Error(m.message));
              pending.current.delete(m.id);
            }
          }
        };
        w.onerror = (e) => reject(new Error(e.message || 'The search model could not start.'));
      });
      ready.current.catch(() => {}); // handled where awaited
      const ortBase = new URL('ort/', document.baseURI).href;
      w.postMessage({ type: 'init', modelId, ortBase } satisfies WorkerIn);
    },
    [stopWorker],
  );

  const embed = useCallback(async (texts: string[]): Promise<Float32Array> => {
    if (!worker.current || !ready.current) throw new Error('Smart search is off.');
    await ready.current;
    const id = nextId.current++;
    const w = worker.current;
    return new Promise((resolve, reject) => {
      pending.current.set(id, { resolve, reject });
      w.postMessage({ type: 'embed', id, texts } satisfies WorkerIn);
    });
  }, []);

  const persist = useCallback((m: ModelKey) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void dbSet(storeKey(m), Object.fromEntries(store.current)), 1500);
  }, []);

  /** Bring the vectors up to date with the notes: embed new/changed notes, drop deleted ones. */
  const reindex = useCallback(async () => {
    if (indexing.current) {
      indexAgain.current = true;
      return;
    }
    indexing.current = true;
    const gen = generation.current;
    const m = info.settings.model;
    const mdl = MODELS[m];
    try {
      do {
        indexAgain.current = false;
        const notes = atlasRef.current.getState().notes;
        const ids = new Set(notes.map((n) => n.id));
        let changed = false;
        for (const id of [...store.current.keys()]) if (!ids.has(id)) (store.current.delete(id), (changed = true));
        const todo = notes.filter((n) => store.current.get(n.id)?.h !== noteHash(n));
        const total = notes.length;
        setInfo((i) => ({ ...i, status: todo.length ? 'indexing' : 'ready', indexed: total - todo.length, total }));
        let done = total - todo.length;
        for (const n of todo) {
          const h = noteHash(n);
          const v = await embed(chunkNote(n).map((c) => mdl.passagePrefix + c));
          if (gen !== generation.current) return; // turned off or switched model meanwhile
          store.current.set(n.id, { h, v });
          changed = true;
          done++;
          if (done % 5 === 0 || done === total) setInfo((i) => ({ ...i, indexed: done, version: i.version + 1 }));
        }
        if (changed) {
          persist(m);
          setInfo((i) => ({ ...i, version: i.version + 1 }));
        }
      } while (indexAgain.current && gen === generation.current);
      if (gen === generation.current) setInfo((i) => ({ ...i, status: 'ready', error: null }));
    } catch (e) {
      if (gen === generation.current && (e as Error).message !== 'stopped')
        setInfo((i) => ({ ...i, status: 'error', error: (e as Error).message }));
    } finally {
      indexing.current = false;
    }
  }, [embed, persist, info.settings.model]);

  const active = loaded && enabled && atlas.ready && !atlas.inactive;

  // Start the model and load saved vectors when smart search is on.
  useEffect(() => {
    if (!active) return;
    const gen = ++generation.current;
    setInfo((i) => ({ ...i, status: 'loading', download: null, error: null }));
    void (async () => {
      store.current = validStore(await dbGet(storeKey(modelKey)));
      if (gen !== generation.current) return;
      setInfo((i) => ({ ...i, version: i.version + 1 }));
      startWorker(MODELS[modelKey].id);
      try {
        await ready.current;
      } catch (e) {
        if (gen === generation.current) setInfo((i) => ({ ...i, status: 'error', error: (e as Error).message }));
        return;
      }
      if (gen === generation.current) {
        setInfo((i) => ({ ...i, download: null }));
        void reindex();
      }
    })();
    return () => {
      generation.current++;
      stopWorker();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, modelKey]);

  // Re-index a moment after notes change.
  useEffect(() => {
    if (!active || info.status === 'loading' || info.status === 'error') return;
    const t = setTimeout(() => void reindex(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atlas.notes, active]);

  const saveSettings = useCallback(async (s: Settings) => {
    await dbSet(SETTINGS_KEY, s);
    // Show "loading" straight away when turning on or switching model, not the previous state.
    setInfo((i) => ({ ...i, settings: s, status: s.enabled ? 'loading' : 'off', download: null, error: null }));
  }, []);

  const enable = useCallback(
    async (m: ModelKey) => {
      // Switching language: the other model's vectors are useless now, so free their space.
      if (m !== modelKey) await dbDelete(storeKey(modelKey));
      await saveSettings({ enabled: true, model: m });
    },
    [saveSettings, modelKey],
  );

  /** Turn off and free the space: saved vectors and the cached model files. */
  const disable = useCallback(async () => {
    generation.current++;
    stopWorker();
    store.current = new Map();
    await Promise.all((Object.keys(MODELS) as ModelKey[]).map((m) => dbDelete(storeKey(m))));
    try {
      await caches.delete('transformers-cache');
    } catch {
      /* Cache Storage unavailable */
    }
    await saveSettings({ enabled: false, model: modelKey });
    setInfo((i) => ({ ...i, status: 'off', indexed: 0, total: 0, download: null, error: null, version: i.version + 1 }));
  }, [stopWorker, saveSettings, modelKey]);

  const retry = useCallback(() => {
    setInfo((i) => ({ ...i, settings: { ...i.settings, enabled: false } }));
    setTimeout(() => setInfo((i) => ({ ...i, settings: { ...i.settings, enabled: true } })), 0);
  }, []);

  /** Notes matching the meaning of `query`. Empty if smart search isn't ready. */
  const search = useCallback(
    async (query: string): Promise<SemanticHit[]> => {
      const q = query.trim();
      if (!q || !worker.current || store.current.size === 0) return [];
      try {
        const v = await embed([model.queryPrefix + q]);
        return semanticSearch(v, store.current, model);
      } catch {
        return [];
      }
    },
    [embed, model],
  );

  const related = useCallback(
    (id: string, exclude: Set<string>) => (enabled ? relatedNotes(id, store.current, model, exclude) : []),
    // version: recompute when vectors change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, model, info.version],
  );

  return { ...info, model, enable, disable, retry, search, related };
}

export type Semantic = ReturnType<typeof useSemantic>;
