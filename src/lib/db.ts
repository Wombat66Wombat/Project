/**
 * Tiny key-value wrapper around IndexedDB (much more space than localStorage).
 * If IndexedDB is unavailable (some private-browsing modes), it falls back to localStorage.
 */
const DB_NAME = 'atlas';
const STORE = 'kv';
const LS_PREFIX = 'atlas:kv:';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  if (db) {
    try {
      return (await tx(db, 'readonly', (s) => s.get(key))) as T | undefined;
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

/** Resolves false if the value couldn't be stored anywhere. */
export async function dbSet(key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => s.put(value, key));
      return true;
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function dbDelete(key: string): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await tx(db, 'readwrite', (s) => s.delete(key));
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* ignore */
  }
}
