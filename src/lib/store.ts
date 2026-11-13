import type { Note } from './types';
import { seedNotes } from './seed';

const KEY = 'atlas:v1:notes';

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

/** Parse and validate notes from JSON (used for both storage and file import). */
export function parseNotes(json: string): Note[] {
  const data: unknown = JSON.parse(json);
  const list = Array.isArray(data) ? data : (data as { notes?: unknown })?.notes;
  if (!Array.isArray(list)) throw new Error('No notes found in file.');
  return list.filter(isNote).map((n) => ({ ...n, type: 'note' as const }));
}

/** Load notes from browser storage. Falls back to the welcome notes on first run or if storage is unavailable. */
export function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseNotes(raw);
  } catch {
    /* private mode, blocked storage or corrupt data: start fresh */
  }
  return seedNotes();
}

/** Returns false if the browser refused to save (e.g. storage full or disabled). */
export function saveNotes(notes: Note[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

export function exportJson(notes: Note[]): string {
  return JSON.stringify({ app: 'atlas', version: 1, exportedAt: new Date().toISOString(), notes }, null, 2);
}
