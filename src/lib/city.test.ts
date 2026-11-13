import { describe, expect, it } from 'vitest';
import { buildCity, communities } from './city';
import { buildIndex } from './links';
import type { Note } from './types';

const n = (title: string, body = '', updatedAt = 0): Note => ({ id: title, type: 'note', title, body, createdAt: 0, updatedAt });
// Two clusters joined by one bridge, plus a loner.
const notes = [
  n('Sleep', '[[Memory]] [[Dreams]] [[Naps]]'),
  n('Memory', '[[Dreams]]'),
  n('Dreams'),
  n('Naps', '[[Memory]]'),
  n('Pasta', '[[Garlic]] [[Tomato]] [[Basil]]'),
  n('Garlic', '[[Tomato]]'),
  n('Tomato', '[[Basil]]'),
  n('Basil'),
  n('Bridge', '[[Sleep]] [[Pasta]]'),
  n('Loner'),
];
const ix = buildIndex(notes);

describe('city', () => {
  it('finds communities of linked notes', () => {
    const c = communities(notes, ix);
    expect(new Set(['Sleep', 'Memory', 'Dreams', 'Naps'].map((x) => c.get(x))).size).toBe(1);
    expect(new Set(['Pasta', 'Garlic', 'Tomato', 'Basil'].map((x) => c.get(x))).size).toBe(1);
    expect(c.get('Sleep')).not.toBe(c.get('Pasta'));
  });
  it('lays out districts without overlapping buildings, hubs in the middle', () => {
    const city = buildCity(notes, ix, 30 * 86_400_000);
    expect(city.buildings).toHaveLength(10);
    const spots = new Set(city.buildings.map((b) => `${b.x},${b.z}`));
    expect(spots.size).toBe(10);
    const outskirts = city.districts.find((d) => d.name === 'Outskirts')!;
    expect(outskirts.count).toBe(1);
    expect(city.districts[city.districts.length - 1]).toBe(outskirts);
    const sleep = city.buildings.find((b) => b.id === 'Sleep')!;
    const dreams = city.buildings.find((b) => b.id === 'Dreams')!;
    expect(sleep.height).toBeGreaterThan(dreams.height); // more links, taller
    expect(city.districts.map((d) => d.name)).toContain('Sleep'); // named after its hub
  });
  it('lights up recently edited notes and draws a road per link', () => {
    const now = 100 * 86_400_000;
    const city = buildCity([n('Fresh', '[[Old]]', now), n('Old', '', now - 60 * 86_400_000)], buildIndex([n('Fresh', '[[Old]]'), n('Old')]), now);
    expect(city.buildings.find((b) => b.id === 'Fresh')!.glow).toBe(1);
    expect(city.buildings.find((b) => b.id === 'Old')!.glow).toBe(0);
    expect(city.roads).toEqual([['Fresh', 'Old']]);
  });
  it('handles an empty atlas', () => {
    expect(buildCity([], buildIndex([]))).toEqual({ buildings: [], districts: [], roads: [] });
  });
});
