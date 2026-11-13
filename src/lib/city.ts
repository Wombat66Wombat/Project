import type { GraphIndex, Note } from './types';

export interface Building {
  id: string;
  title: string;
  district: number;
  x: number;
  z: number;
  /** Width/depth of the footprint. */
  size: number;
  height: number;
  /** 0–1: how recently the note was edited (1 = today). Lights up the windows. */
  glow: number;
  links: number;
}

export interface District {
  id: number;
  name: string;
  /** Centre and half-size of the district's square plot. */
  x: number;
  z: number;
  half: number;
  count: number;
  /** Most-linked notes, for the list view. */
  top: string[];
}

export interface City {
  buildings: Building[];
  districts: District[];
  roads: [string, string][];
}

/** Undirected neighbours of every note, from links in both directions. */
function neighbours(notes: Note[], ix: GraphIndex): Map<string, Set<string>> {
  const nb = new Map(notes.map((n) => [n.id, new Set<string>()]));
  for (const [from, tos] of ix.outgoing) for (const to of tos) {
    nb.get(from)?.add(to);
    nb.get(to)?.add(from);
  }
  return nb;
}

/**
 * Communities by label propagation: every note repeatedly takes the most common label among
 * its neighbours, so densely linked groups settle on a shared label. Deterministic (fixed
 * order, ties go to the smallest label) so the city doesn't reshuffle between visits.
 */
export function communities(notes: Note[], ix: GraphIndex, rounds = 20): Map<string, string> {
  const nb = neighbours(notes, ix);
  const ids = notes.map((n) => n.id).sort();
  const label = new Map(ids.map((id) => [id, id]));
  for (let r = 0; r < rounds; r++) {
    let changed = false;
    for (const id of ids) {
      const counts = new Map<string, number>();
      for (const o of nb.get(id)!) counts.set(label.get(o)!, (counts.get(label.get(o)!) ?? 0) + 1);
      if (!counts.size) continue;
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
      if (best !== label.get(id)) {
        label.set(id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return label;
}

const DAY = 86_400_000;

/**
 * Lay out the city: one square district per community (biggest first, spiralling out from the
 * centre), unlinked notes together in "Outskirts"; inside a district, the most-linked notes stand
 * in the middle. Heights grow with links, footprints with note length, glow with recency.
 */
export function buildCity(notes: Note[], ix: GraphIndex, now = Date.now()): City {
  if (notes.length === 0) return { buildings: [], districts: [], roads: [] };
  const nb = neighbours(notes, ix);
  const label = communities(notes, ix);
  const groups = new Map<string, Note[]>();
  for (const n of notes) {
    const key = nb.get(n.id)!.size === 0 ? '__outskirts' : label.get(n.id)!;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    if (a[0] === '__outskirts') return 1;
    if (b[0] === '__outskirts') return -1;
    return b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1);
  });

  const LOT = 3;
  const GAP = 4;
  const degree = (id: string) => nb.get(id)!.size;
  // District plots placed on a square spiral around the centre.
  const sizes = ordered.map(([, g]) => Math.ceil(Math.sqrt(g.length)) * LOT);
  const cell = Math.max(...sizes) + GAP;
  const spiral = (i: number): [number, number] => {
    if (i === 0) return [0, 0];
    let x = 0;
    let z = 0;
    let step = 1;
    let k = 0;
    const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (let d = 0; ; d++) {
      for (let rep = 0; rep < 2; rep++) {
        const [dx, dz] = dirs[(d * 2 + rep) % 4];
        for (let s = 0; s < step; s++) {
          x += dx;
          z += dz;
          if (++k === i) return [x, z];
        }
      }
      step++;
    }
  };

  const buildings: Building[] = [];
  const districts: District[] = [];
  ordered.forEach(([key, group], di) => {
    const [gx, gz] = spiral(di);
    const side = Math.ceil(Math.sqrt(group.length));
    const half = (side * LOT) / 2;
    const cx = gx * cell;
    const cz = gz * cell;
    // Lots sorted by distance from the plot's centre; the most-linked notes get the central ones.
    const lots: [number, number][] = [];
    for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) lots.push([i, j]);
    const mid = (side - 1) / 2;
    lots.sort((a, b) => Math.hypot(a[0] - mid, a[1] - mid) - Math.hypot(b[0] - mid, b[1] - mid) || a[0] - b[0] || a[1] - b[1]);
    const sorted = [...group].sort((a, b) => degree(b.id) - degree(a.id) || a.title.localeCompare(b.title));
    sorted.forEach((n, i) => {
      const [li, lj] = lots[i];
      const links = degree(n.id);
      const ageDays = Math.max(0, (now - n.updatedAt) / DAY);
      buildings.push({
        id: n.id,
        title: n.title || 'Untitled',
        district: di,
        x: cx - half + li * LOT + LOT / 2,
        z: cz - half + lj * LOT + LOT / 2,
        size: Math.min(2.4, 1.2 + Math.log10(1 + n.body.length) * 0.3),
        height: Math.min(24, 1 + links * 1.6),
        glow: Math.max(0, 1 - ageDays / 30),
        links,
      });
    });
    const hub = sorted[0];
    districts.push({
      id: di,
      name: key === '__outskirts' ? 'Outskirts' : hub.title || 'Untitled',
      x: cx,
      z: cz,
      half,
      count: group.length,
      top: sorted.slice(0, 5).map((n) => n.id),
    });
  });

  const roads: [string, string][] = [];
  for (const [from, tos] of ix.outgoing) for (const to of tos) if (from < to || !ix.outgoing.get(to)?.has(from)) roads.push([from, to]);
  return { buildings, districts, roads };
}
