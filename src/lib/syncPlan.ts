import { diff3Merge } from 'node-diff3';
import type { Note } from './types';
import type { Tombstone } from './store';
import { gitBlobSha, serializeNote, slugify, titleFromPath } from './noteFile';
import { createNote } from './store';

/** What a note looked like the last time it was in sync with GitHub (the common ancestor for merges). */
export interface BaseEntry {
  path: string;
  sha: string;
  title: string;
  body: string;
}
export type Base = Record<string, BaseEntry>;

/** A Markdown file on GitHub. `note` is set when its content was downloaded (it changed since the last sync). */
export interface RemoteFile {
  path: string;
  sha: string;
  note?: Note;
}

export interface SyncPlan {
  /** Notes to add or replace locally. */
  upserts: Note[];
  /** Local note ids to remove (deleted on GitHub). */
  removes: string[];
  /** Files to write on GitHub. */
  writes: { path: string; content: string }[];
  /** Paths to delete on GitHub. */
  deletes: string[];
  /** The base to keep once the writes are committed. */
  newBase: Base;
  /** Tombstones that are dealt with. */
  clearedTombstones: string[];
  /** Titles of notes changed in incompatible ways on both sides (a copy was kept). */
  conflicts: string[];
  /** Number of notes merged automatically from both sides. */
  merged: number;
}

/** Files whose content we must download: anything not exactly as it was at the last sync. */
export function filesToFetch(files: RemoteFile[], base: Base): RemoteFile[] {
  const known = new Set(Object.values(base).map((b) => `${b.path}\0${b.sha}`));
  return files.filter((f) => !known.has(`${f.path}\0${f.sha}`));
}

function mergeText(local: string, base: string, remote: string): string | null {
  const blocks = diff3Merge(local.split('\n'), base.split('\n'), remote.split('\n'));
  const out: string[] = [];
  for (const b of blocks) {
    if (b.ok) out.push(...b.ok);
    else return null;
  }
  return out.join('\n');
}

/** Welcome notes never edited on this device: GitHub's copy always wins (e.g. on a second device). */
const SEED_IDS = new Set(['welcome', 'how-links-work', 'roadmap']);
const pristineSeed = (n: Note) => SEED_IDS.has(n.id) && n.createdAt === n.updatedAt;

const same = (a: { title: string; body: string }, b: { title: string; body: string }) =>
  a.title === b.title && a.body === b.body;

/**
 * Decide what to do for every note, given the local notes, GitHub's files and the last-synced base.
 *
 * - Changed only on one side → copy it to the other side.
 * - Changed on both sides → 3-way merge. If the same lines changed, keep the local version
 *   and save GitHub's version as a separate "(GitHub copy)" note, so nothing is lost.
 * - Deleted on one side and edited on the other → keep the edited note.
 */
export async function planSync(args: {
  local: Note[];
  tombstones: Tombstone[];
  base: Base;
  remote: RemoteFile[];
  folder: string;
}): Promise<SyncPlan> {
  const { local, tombstones, base, folder } = args;
  const plan: SyncPlan = {
    upserts: [], removes: [], writes: [], deletes: [], newBase: {}, clearedTombstones: [], conflicts: [], merged: 0,
  };

  // Resolve every remote file to a note id.
  const baseByPath = new Map(Object.entries(base).map(([id, b]) => [b.path, { id, b }]));
  const remoteById = new Map<string, { path: string; sha: string; note: Note }>();
  const pathOwner = new Map<string, string>();
  for (const f of args.remote) {
    const known = baseByPath.get(f.path);
    let note: Note;
    if (known && known.b.sha === f.sha) {
      const loc = local.find((n) => n.id === known.id);
      note = { ...(loc ?? createNote('')), id: known.id, title: known.b.title, body: known.b.body };
    } else if (f.note) {
      note = f.note;
    } else {
      continue; // not downloaded; shouldn't happen
    }
    if (remoteById.has(note.id)) note = { ...note, id: `gh:${f.path}` }; // duplicated file
    remoteById.set(note.id, { path: f.path, sha: f.sha, note });
    pathOwner.set(f.path, note.id);
  }

  const localById = new Map(local.map((n) => [n.id, n]));
  const tombById = new Map(tombstones.map((t) => [t.id, t]));
  const ids = new Set([...localById.keys(), ...remoteById.keys(), ...Object.keys(base), ...tombById.keys()]);

  const prefix = folder ? `${folder.replace(/\/+$/, '')}/` : '';

  function pathFor(note: Note, current: string | undefined): string {
    const slug = slugify(note.title);
    if (current) {
      const name = titleFromPath(current);
      if (name === slug || new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`).test(name)) return current;
    }
    for (let i = 1; ; i++) {
      const p = `${prefix}${i === 1 ? slug : `${slug} ${i}`}.md`;
      const owner = pathOwner.get(p);
      if (!owner || owner === note.id) return p;
    }
  }

  async function push(note: Note, current: string | undefined) {
    const path = pathFor(note, current);
    if (current && current !== path) {
      plan.deletes.push(current);
      if (pathOwner.get(current) === note.id) pathOwner.delete(current);
    }
    pathOwner.set(path, note.id);
    const content = serializeNote(note);
    plan.writes.push({ path, content });
    plan.newBase[note.id] = { path, sha: await gitBlobSha(content), title: note.title, body: note.body };
  }

  function takeRemote(r: { path: string; sha: string; note: Note }) {
    plan.upserts.push(r.note);
    plan.newBase[r.note.id] = { path: r.path, sha: r.sha, title: r.note.title, body: r.note.body };
  }

  for (const id of ids) {
    const L = localById.get(id);
    const T = tombById.get(id);
    const B = base[id];
    const R = remoteById.get(id);
    if (T) plan.clearedTombstones.push(id);

    const remoteChanged = R ? !B || R.sha !== B.sha || R.path !== B.path : !!B;
    const localChanged = L ? (!B && !pristineSeed(L)) || (!!B && !same(L, B)) : !!B && !!T;

    if (L && R) {
      if (!localChanged && !remoteChanged) {
        plan.newBase[id] = B;
      } else if (!localChanged) {
        takeRemote(R);
      } else if (!remoteChanged) {
        await push(L, R.path);
      } else if (same(L, R.note)) {
        plan.newBase[id] = { path: R.path, sha: R.sha, title: L.title, body: L.body };
      } else {
        // Changed on both sides.
        const title = !B || L.title !== B.title ? L.title : R.note.title;
        const body = B ? mergeText(L.body, B.body, R.note.body) : null;
        if (body !== null) {
          const mergedNote: Note = { ...L, title, body, updatedAt: Math.max(L.updatedAt, R.note.updatedAt) };
          plan.upserts.push(mergedNote);
          plan.merged++;
          await push(mergedNote, R.path);
        } else {
          await push(L, R.path);
          const copy = createNote(`${R.note.title} (GitHub copy)`, R.note.body);
          plan.upserts.push(copy);
          plan.conflicts.push(L.title);
          await push(copy, undefined);
        }
      }
    } else if (L && !R) {
      if (B && !localChanged) plan.removes.push(id); // deleted on GitHub
      else if (!B && pristineSeed(L) && remoteById.size > 0) plan.removes.push(id); // don't spread welcome notes into an existing repo
      else await push(L, undefined); // new locally, or edited locally after being deleted on GitHub
    } else if (!L && R) {
      if (T && B && !remoteChanged) plan.deletes.push(R.path); // deleted locally
      else takeRemote(R); // new on GitHub, or edited there after being deleted here
    }
    // !L && !R: gone on both sides; nothing to keep.
  }

  return plan;
}
