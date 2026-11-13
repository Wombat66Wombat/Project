import type { Note } from './types';
import type { Tombstone } from './store';
import { GitHub, GitHubError, type SyncConfig } from './github';
import { parseNoteFile } from './noteFile';
import { filesToFetch, planSync, type Base, type SyncPlan } from './syncPlan';

export interface SyncOutcome {
  plan: SyncPlan;
  repoPrivate: boolean;
  /** Number of files changed on GitHub by this sync. */
  pushed: number;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export function normalizeFolder(folder: string): string {
  return folder.trim().replace(/^\/+|\/+$/g, '') || 'notes';
}

/**
 * One full sync: download what changed on GitHub, merge with local changes,
 * and push the result as a single commit. Retries once if GitHub moved underneath us.
 */
export async function runSync(
  cfg: SyncConfig,
  state: { notes: Note[]; tombstones: Tombstone[]; base: Base },
  fetchImpl?: typeof fetch,
): Promise<SyncOutcome> {
  const gh = new GitHub(cfg, fetchImpl);
  const folder = normalizeFolder(cfg.folder);
  const info = await gh.repoInfo();
  if (!info.canPush) throw new GitHubError('The token can read this repository but not write to it. Give it “Contents: Read and write”.', 403);
  const branch = cfg.branch.trim() || info.defaultBranch;

  for (let attempt = 0; ; attempt++) {
    let head = await gh.head(branch);
    if (!head) {
      try {
        await gh.init(branch);
      } catch (e) {
        throw new GitHubError(`Branch “${branch}” doesn't exist in this repository.`, e instanceof GitHubError ? e.status : 0);
      }
      head = await gh.head(branch);
      if (!head) throw new GitHubError(`Branch “${branch}” doesn't exist in this repository.`, 404);
    }

    const { treeSha, files } = await gh.files(head);
    const mdFiles = files.filter((f) => f.path.startsWith(`${folder}/`) && /\.md$/i.test(f.path));
    const toFetch = filesToFetch(mdFiles, state.base);
    const fetched = new Map(
      await mapLimit(toFetch, 6, async (f) => [f.path, parseNoteFile(await gh.blob(f.sha), f.path)] as const),
    );
    const remote = mdFiles.map((f) => ({ ...f, note: fetched.get(f.path) }));

    const plan = await planSync({ local: state.notes, tombstones: state.tombstones, base: state.base, remote, folder });
    const pushed = plan.writes.length + plan.deletes.length;
    if (pushed === 0) return { plan, repoPrivate: info.private, pushed };

    try {
      const n = plan.writes.length;
      const d = plan.deletes.length;
      const parts = [n && `update ${n} note${n === 1 ? '' : 's'}`, d && `delete ${d}`].filter(Boolean).join(', ');
      await gh.commit({ branch, parent: head, baseTree: treeSha, writes: plan.writes, deletes: plan.deletes, message: `Atlas: ${parts}` });
      return { plan, repoPrivate: info.private, pushed };
    } catch (e) {
      // Another device pushed between our read and our write: start over with the new state.
      if (attempt < 2 && e instanceof GitHubError && e.status === 422) continue;
      throw e;
    }
  }
}
