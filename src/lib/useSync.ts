import { useCallback, useEffect, useRef, useState } from 'react';
import type { Atlas } from './useAtlas';
import { dbDelete, dbGet, dbSet } from './db';
import { GitHubError, type SyncConfig } from './github';
import { runSync } from './sync';
import type { Base } from './syncPlan';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error' | 'offline';

export interface SyncInfo {
  status: SyncStatus;
  config: SyncConfig | null;
  lastSyncAt: number | null;
  error: string | null;
  /** Messages from the last sync worth showing (conflicts, public repo). */
  notices: string[];
}

const AUTO_INTERVAL = 3 * 60_000;
const AFTER_EDIT = 20_000;
/** Background triggers (tab focus, timer) skip syncing if the last sync was this recent. */
const MIN_GAP = 30_000;

/** Keeps notes in sync with a GitHub repository: on open, a while after edits, every few minutes, and on demand. */
export function useSync(atlas: Atlas) {
  const [info, setInfo] = useState<SyncInfo>({ status: 'off', config: null, lastSyncAt: null, error: null, notices: [] });
  const [loaded, setLoaded] = useState(false);
  const cfgRef = useRef<SyncConfig | null>(null);
  const atlasRef = useRef(atlas);
  atlasRef.current = atlas;
  /** Resolves to an error message, or null on success. */
  const running = useRef<Promise<string | null> | null>(null);
  const again = useRef(false);
  /** The notes array a sync produced, so that applying it doesn't count as an edit. */
  const fromSync = useRef<unknown>(null);
  const lastAt = useRef(0);
  /** Set by connect(), which already ran a sync, so activation doesn't immediately sync again. */
  const justConnected = useRef(false);
  const warnedPublic = useRef(false);

  useEffect(() => {
    void (async () => {
      const config = (await dbGet<SyncConfig>('syncConfig')) ?? null;
      const lastSyncAt = (await dbGet<number>('syncLastAt')) ?? null;
      cfgRef.current = config;
      lastAt.current = lastSyncAt ?? 0;
      setInfo((i) => ({ ...i, config, lastSyncAt, status: config ? 'synced' : 'off' }));
      setLoaded(true);
    })();
  }, []);

  const syncOnce = useCallback(async (): Promise<string | null> => {
    const cfg = cfgRef.current;
    if (!cfg || atlasRef.current.inactive) return null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setInfo((i) => ({ ...i, status: 'offline' }));
      return "You're offline.";
    }
    setInfo((i) => ({ ...i, status: 'syncing', error: null }));
    try {
      const a = atlasRef.current;
      const base = (await dbGet<Base>('syncBase')) ?? {};
      const state = a.getState();
      const out = await runSync(cfg, { ...state, base });
      const skipped = a.applySync({ snapshot: state.notes, ...out.plan });
      fromSync.current = a.getState().notes;
      const newBase = { ...out.plan.newBase };
      for (const id of skipped) {
        if (base[id]) newBase[id] = base[id];
        else delete newBase[id];
      }
      await dbSet('syncBase', newBase);
      const now = Date.now();
      await dbSet('syncLastAt', now);
      lastAt.current = now;
      const notices: string[] = [];
      for (const t of out.plan.conflicts)
        notices.push(`“${t}” was changed on two devices in the same place. Both versions are kept: the other one is “${t} (GitHub copy)”.`);
      if (!out.repoPrivate && !warnedPublic.current) {
        warnedPublic.current = true;
        notices.push('Warning: this repository is public, so anyone can read your notes. Make it private in the repository’s settings on GitHub.');
      }
      setInfo((i) => ({ ...i, status: 'synced', lastSyncAt: now, error: null, notices: notices.length ? notices : i.notices }));
      return null;
    } catch (e) {
      const msg = (e as Error).message;
      const offline = e instanceof GitHubError && e.status === 0 && /online/.test(msg);
      setInfo((i) => ({ ...i, status: offline ? 'offline' : 'error', error: msg }));
      return msg;
    }
  }, []);

  /** Run a sync, or queue one more if a sync is already running. */
  const syncNow = useCallback((): Promise<string | null> => {
    if (running.current) {
      again.current = true;
      return running.current;
    }
    const task = syncOnce().finally(() => {
      running.current = null;
      if (again.current) {
        again.current = false;
        void syncNow();
      }
    });
    running.current = task;
    return task;
  }, [syncOnce]);

  /** Save settings and run a first sync. Throws a readable error if it fails, keeping the old settings. */
  const connect = useCallback(
    async (cfg: SyncConfig) => {
      if (running.current) await running.current;
      const prev = cfgRef.current;
      const changedTarget = !prev || prev.repo !== cfg.repo || prev.folder !== cfg.folder || prev.branch !== cfg.branch;
      const oldBase = await dbGet<Base>('syncBase');
      cfgRef.current = cfg;
      if (changedTarget) await dbSet('syncBase', {});
      const error = await syncNow();
      if (error) {
        cfgRef.current = prev;
        await dbSet('syncBase', oldBase ?? {});
        setInfo((i) => ({ ...i, config: prev, status: prev ? 'synced' : 'off', error: null }));
        throw new Error(error);
      }
      await dbSet('syncConfig', cfg);
      justConnected.current = true;
      setInfo((i) => ({ ...i, config: cfg }));
    },
    [syncNow],
  );

  const disconnect = useCallback(async () => {
    cfgRef.current = null;
    atlasRef.current.clearTombstones();
    await dbDelete('syncConfig');
    await dbDelete('syncBase');
    await dbDelete('syncLastAt');
    setInfo({ status: 'off', config: null, lastSyncAt: null, error: null, notices: [] });
  }, []);

  const dismissNotices = useCallback(() => setInfo((i) => ({ ...i, notices: [] })), []);

  const active = loaded && atlas.ready && !atlas.inactive && !!info.config;
  const background = useCallback(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastAt.current > MIN_GAP) void syncNow();
  }, [syncNow]);

  // Without sync, records of deleted notes are useless; drop them.
  useEffect(() => {
    if (loaded && atlas.ready && !info.config && atlas.getState().tombstones.length) atlas.clearTombstones();
  }, [loaded, atlas, info.config]);

  // Sync on open, periodically while visible, and when coming back online or to the tab.
  useEffect(() => {
    if (!active) return;
    fromSync.current = atlasRef.current.getState().notes;
    if (justConnected.current) justConnected.current = false;
    else void syncNow(); // always sync when Atlas opens
    const tick = setInterval(background, AUTO_INTERVAL);
    const onVisible = background;
    const onOnline = () => void syncNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [active, syncNow, background]);

  // Sync a little while after the last edit (but not after changes that came from sync itself).
  useEffect(() => {
    if (!active || atlas.notes === fromSync.current) return;
    const t = setTimeout(() => void syncNow(), AFTER_EDIT);
    return () => clearTimeout(t);
  }, [atlas.notes, active, syncNow]);

  return { ...info, syncNow, connect, disconnect, dismissNotices };
}

export type Sync = ReturnType<typeof useSync>;
