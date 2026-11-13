import { beforeEach, describe, expect, it } from 'vitest';
import { FakeGitHub } from './fakeGitHub';
import { runSync } from './sync';
import { seedNotes } from './seed';
import { createNote, type Tombstone } from './store';
import type { Base } from './syncPlan';
import type { Note } from './types';
import type { SyncConfig } from './github';

/** A device: its own notes, deletions and last-synced base, updated the way the app does after a sync. */
class Device {
  tombstones: Tombstone[] = [];
  base: Base = {};
  constructor(public notes: Note[], private gh: FakeGitHub) {}

  cfg(token = this.gh.token): SyncConfig {
    return { repo: 'me/atlas-notes', folder: 'notes', branch: '', token };
  }
  async sync() {
    const out = await runSync(this.cfg(), { notes: this.notes, tombstones: this.tombstones, base: this.base }, this.gh.fetch);
    const { plan } = out;
    const up = new Map(plan.upserts.map((n) => [n.id, n]));
    this.notes = this.notes.filter((n) => !plan.removes.includes(n.id) && !up.has(n.id)).concat(plan.upserts);
    this.tombstones = this.tombstones.filter((t) => !plan.clearedTombstones.includes(t.id));
    this.base = plan.newBase;
    return out;
  }
  get(title: string) {
    return this.notes.find((n) => n.title === title);
  }
  edit(title: string, body: string) {
    const n = this.get(title)!;
    this.notes = this.notes.map((x) => (x.id === n.id ? { ...x, body, updatedAt: x.updatedAt + 1000 } : x));
  }
  rename(title: string, to: string) {
    this.notes = this.notes.map((x) => (x.title === title ? { ...x, title: to, updatedAt: x.updatedAt + 1000 } : x));
  }
  remove(title: string) {
    const n = this.get(title)!;
    this.notes = this.notes.filter((x) => x.id !== n.id);
    this.tombstones.push({ id: n.id, deletedAt: Date.now() });
  }
  add(title: string, body: string) {
    this.notes.push(createNote(title, body));
  }
  titles() {
    return this.notes.map((n) => n.title).sort();
  }
}

const bodies = (d: Device) => Object.fromEntries(d.notes.map((n) => [n.title, n.body]));

let gh: FakeGitHub;
let a: Device;
let b: Device;

beforeEach(async () => {
  gh = new FakeGitHub();
  a = new Device(seedNotes(), gh);
  b = new Device(seedNotes(), gh);
  await a.sync();
  await b.sync();
});

describe('GitHub sync', () => {
  it('sets up an empty repo and stores notes as Markdown files', () => {
    const files = gh.snapshot();
    expect(Object.keys(files).sort()).toEqual([
      'README.md', 'notes/How links work.md', 'notes/Roadmap.md', 'notes/Welcome to Atlas.md',
    ]);
    expect(files['notes/Roadmap.md']).toMatch(/^---\nid: "roadmap"\ntitle: "Roadmap"\n/);
  });

  it('a second device gets the notes without duplicates', () => {
    expect(b.titles()).toEqual(a.titles());
    expect(b.titles()).toHaveLength(3);
  });

  it("doesn't copy a new device's welcome notes into a repo that already has notes", async () => {
    const g = new FakeGitHub();
    const first = new Device([createNote('Mine', 'only this')], g);
    await first.sync();
    const fresh = new Device(seedNotes(), g);
    await fresh.sync();
    expect(fresh.titles()).toEqual(['Mine']);
    expect(Object.keys(g.snapshot()).filter((p) => p.startsWith('notes/'))).toEqual(['notes/Mine.md']);
  });

  it('does nothing (and downloads nothing) when nothing changed', async () => {
    gh.requests = [];
    const out = await a.sync();
    expect(out.pushed).toBe(0);
    expect(gh.requests.filter((r) => r.includes('/git/blobs/'))).toEqual([]);
    expect(gh.requests.some((r) => r.startsWith('POST'))).toBe(false);
  });

  it('carries edits and new notes from one device to the other', async () => {
    a.edit('Roadmap', 'New plan');
    a.add('Sleep', 'Matters');
    await a.sync();
    await b.sync();
    expect(bodies(b)).toMatchObject({ Roadmap: 'New plan', Sleep: 'Matters' });
  });

  it('merges edits to different lines automatically', async () => {
    a.add('List', 'one\ntwo\nthree\nfour\nfive');
    await a.sync();
    await b.sync();
    a.edit('List', 'ONE\ntwo\nthree\nfour\nfive');
    b.edit('List', 'one\ntwo\nthree\nfour\nFIVE');
    await a.sync();
    const out = await b.sync();
    expect(out.plan.merged).toBe(1);
    await a.sync();
    expect(bodies(a).List).toBe('ONE\ntwo\nthree\nfour\nFIVE');
    expect(bodies(b).List).toBe('ONE\ntwo\nthree\nfour\nFIVE');
  });

  it('keeps both versions when the same line was edited on both devices', async () => {
    a.edit('Roadmap', 'Version A');
    b.edit('Roadmap', 'Version B');
    await a.sync();
    const out = await b.sync();
    expect(out.plan.conflicts).toEqual(['Roadmap']);
    await a.sync();
    for (const d of [a, b]) {
      expect(bodies(d)).toMatchObject({ Roadmap: 'Version B', 'Roadmap (GitHub copy)': 'Version A' });
    }
  });

  it('syncs deletions', async () => {
    a.remove('Roadmap');
    await a.sync();
    expect(gh.snapshot()['notes/Roadmap.md']).toBeUndefined();
    await b.sync();
    expect(b.get('Roadmap')).toBeUndefined();
  });

  it('keeps a note that was edited on one device and deleted on the other', async () => {
    a.remove('Roadmap');
    b.edit('Roadmap', 'Still needed');
    await b.sync();
    await a.sync();
    expect(bodies(a).Roadmap).toBe('Still needed');
    expect(a.tombstones).toEqual([]);
  });

  it('moves the file when a note is renamed', async () => {
    a.rename('Roadmap', 'Plan');
    await a.sync();
    const files = gh.snapshot();
    expect(files['notes/Roadmap.md']).toBeUndefined();
    expect(files['notes/Plan.md']).toContain('title: "Plan"');
    await b.sync();
    expect(b.titles()).toContain('Plan');
    expect(b.titles()).not.toContain('Roadmap');
  });

  it('gives notes with the same file name different files', async () => {
    a.add('A/B', 'slash');
    a.add('A B', 'space');
    await a.sync();
    expect(Object.keys(gh.snapshot())).toEqual(expect.arrayContaining(['notes/A B.md', 'notes/A B 2.md']));
    await a.sync();
    expect(Object.keys(gh.snapshot()).filter((p) => p.startsWith('notes/A B'))).toHaveLength(2);
  });

  it('imports Markdown files written elsewhere (e.g. on github.com or in Obsidian)', async () => {
    await gh.edit({ 'notes/From the web.md': '# Hi\nWritten on GitHub', 'other/ignored.md': 'outside the folder' });
    await a.sync();
    expect(bodies(a)['From the web']).toBe('# Hi\nWritten on GitHub');
    expect(a.titles()).not.toContain('ignored');
    // Editing it in Atlas keeps the same file.
    a.edit('From the web', 'Edited in Atlas');
    await a.sync();
    expect(gh.snapshot()['notes/From the web.md']).toContain('Edited in Atlas');
  });

  it('retries when another device pushes at the same moment', async () => {
    a.edit('Roadmap', 'From A');
    b.add('Other', 'From B');
    gh.beforeRefUpdate = async () => {
      await b.sync();
    };
    await a.sync();
    await b.sync();
    expect(bodies(a)).toMatchObject({ Roadmap: 'From A', Other: 'From B' });
    expect(bodies(b)).toMatchObject({ Roadmap: 'From A', Other: 'From B' });
  });

  it('explains a bad token in plain words', async () => {
    await expect(
      runSync(a.cfg('wrong'), { notes: a.notes, tombstones: [], base: a.base }, gh.fetch),
    ).rejects.toThrow(/rejected the token/);
  });
});
