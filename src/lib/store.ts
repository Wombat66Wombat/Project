import type { Note } from './types';
import { seedNotes } from './seed';
import { dbGet, dbSet } from './db';

/** Where stage 1 kept notes; migrated into IndexedDB on first load. */
const LEGACY_KEY = 'atlas:v1:notes';

/** A note deleted locally that sync still needs to delete on GitHub. */
export interface Tombstone {
  id: string;
  deletedAt: number;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function createNote(title: string, body = ''): Note {
  const now = Date.now();
  return { id: newId(), type: 'note', title, body, createdAt: now, updatedAt: now };
}

function isNote(x: unknown): x is Note {
  if (!x || typeof x !== 'object') return false;
  const n = x as Record<string, unknown>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.body === 'string' &&
    typeof n.createdAt === 'number' &&
    typeof n.updatedAt === 'number'
  );
}

/** Parse and validate notes from JSON (used for file import and the legacy store). */
export function parseNotes(json: string): Note[] {
  const data: unknown = JSON.parse(json);
  const list = Array.isArray(data) ? data : (data as { notes?: unknown })?.notes;
  if (!Array.isArray(list)) throw new Error('No notes found in file.');
  return list.filter(isNote).map((n) => ({ ...n, type: 'note' as const }));
}

export interface Stored {
  notes: Note[];
  tombstones: Tombstone[];
}

/** Load from IndexedDB, migrating stage-1 localStorage notes, or seed the welcome notes on first run. */
export async function loadStored(): Promise<Stored> {
  const notes = await dbGet<Note[]>('notes');
  const tombstones = (await dbGet<Tombstone[]>('tombstones')) ?? [];
  if (Array.isArray(notes)) return { notes: notes.filter(isNote), tombstones };

  let migrated: Note[] | null = null;
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) migrated = parseNotes(raw);
  } catch {
    /* ignore */
  }
  const initial = migrated ?? seedNotes();
  if (await dbSet('notes', initial)) {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* ignore */
    }
  }
  return { notes: initial, tombstones };
}

export async function saveStored(s: Stored): Promise<boolean> {
  const a = await dbSet('notes', s.notes);
  const b = await dbSet('tombstones', s.tombstones);
  return a && b;
}

export function exportJson(notes: Note[]): string {
  return JSON.stringify({ app: 'atlas', version: 1, exportedAt: new Date().toISOString(), notes }, null, 2);
}
