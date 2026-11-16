import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { clearEmergency, loadStored, writeEmergency } from './store';
import type { Note } from './types';

const note = (title: string): Note => ({ id: title, type: 'note', title, body: '', createdAt: 1, updatedAt: 1 });

describe('emergency copy', () => {
  beforeEach(() => {
    localStorage.clear();
    clearEmergency();
  });
  it('restores changes that were written as the page closed', async () => {
    writeEmergency({ notes: [note('Typed just before closing')], tombstones: [] });
    const loaded = await loadStored();
    expect(loaded.notes.map((n) => n.title)).toEqual(['Typed just before closing']);
    expect(localStorage.getItem('atlas:unsaved')).toBeNull(); // moved into IndexedDB
    const again = await loadStored();
    expect(again.notes.map((n) => n.title)).toEqual(['Typed just before closing']);
  });
  it('ignores a damaged emergency copy', async () => {
    localStorage.setItem('atlas:unsaved', '{not json');
    const loaded = await loadStored();
    expect(Array.isArray(loaded.notes)).toBe(true);
  });
});
