import { fromBase64, toBase64 } from './noteFile';

export interface SyncConfig {
  /** "owner/repo" */
  repo: string;
  /** Folder inside the repo for notes, e.g. "notes". */
  folder: string;
  /** Branch; empty means the repo's default branch. */
  branch: string;
  token: string;
}

export class GitHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface RepoInfo {
  defaultBranch: string;
  private: boolean;
  canPush: boolean;
}

type Fetch = typeof fetch;

/** Accepts "owner/repo", "github.com/owner/repo" or a full URL. */
export function parseRepo(input: string): { owner: string; name: string } | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(input.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

/** Minimal GitHub REST client for the calls sync needs. Runs in the browser; the token never leaves it except to api.github.com. */
export class GitHub {
  private base: string;

  constructor(
    private cfg: SyncConfig,
    private fetchImpl: Fetch = (...a) => fetch(...a),
  ) {
    const r = parseRepo(cfg.repo);
    if (!r) throw new GitHubError('Repository should look like “your-name/atlas-notes”.', 0);
    this.base = `https://api.github.com/repos/${r.owner}/${r.name}`;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.base + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.cfg.token.trim()}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError("Couldn't reach GitHub. Are you online?", 0);
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
    let detail = '';
    try {
      detail = ((await res.json()) as { message?: string }).message ?? '';
    } catch {
      /* ignore */
    }
    throw new GitHubError(friendly(res.status, detail, res.headers), res.status);
  }

  async repoInfo(): Promise<RepoInfo> {
    const r = await this.req<{ default_branch: string; private: boolean; permissions?: { push?: boolean } }>('GET', '');
    return { defaultBranch: r.default_branch, private: r.private, canPush: r.permissions?.push !== false };
  }

  /** Latest commit on a branch, or null if the repo is empty / the branch doesn't exist. */
  async head(branch: string): Promise<string | null> {
    try {
      const r = await this.req<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      return r.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null;
      throw e;
    }
  }

  /** Create the first commit in an empty repository. */
  async init(branch: string): Promise<void> {
    await this.req('PUT', '/contents/README.md', {
      message: 'Set up Atlas notes',
      content: toBase64('# Atlas notes\n\nNotes synced by Atlas. Each note is a Markdown file in the `notes` folder.\n'),
      branch,
    });
  }

  /** All files in the commit's tree, with their blob SHAs. */
  async files(commitSha: string): Promise<{ treeSha: string; files: { path: string; sha: string }[] }> {
    const c = await this.req<{ tree: { sha: string } }>('GET', `/git/commits/${commitSha}`);
    const t = await this.req<{ tree: { path: string; type: string; sha: string }[]; truncated: boolean }>(
      'GET',
      `/git/trees/${c.tree.sha}?recursive=1`,
    );
    if (t.truncated) throw new GitHubError('This repository has too many files to sync. Use a separate repo for notes.', 0);
    return { treeSha: c.tree.sha, files: t.tree.filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha })) };
  }

  async blob(sha: string): Promise<string> {
    const b = await this.req<{ content: string; encoding: string }>('GET', `/git/blobs/${sha}`);
    return b.encoding === 'base64' ? fromBase64(b.content) : b.content;
  }

  /** Commit all writes and deletes as one commit, then move the branch to it. */
  async commit(args: {
    branch: string;
    parent: string;
    baseTree: string;
    writes: { path: string; content: string }[];
    deletes: string[];
    message: string;
  }): Promise<string> {
    const tree = await this.req<{ sha: string }>('POST', '/git/trees', {
      base_tree: args.baseTree,
      tree: [
        ...args.writes.map((w) => ({ path: w.path, mode: '100644', type: 'blob', content: w.content })),
        ...args.deletes.map((p) => ({ path: p, mode: '100644', type: 'blob', sha: null })),
      ],
    });
    const commit = await this.req<{ sha: string }>('POST', '/git/commits', {
      message: args.message,
      tree: tree.sha,
      parents: [args.parent],
    });
    await this.req('PATCH', `/git/refs/heads/${encodeURIComponent(args.branch)}`, { sha: commit.sha, force: false });
    return commit.sha;
  }
}

function friendly(status: number, detail: string, headers: Headers): string {
  if (status === 401) return 'GitHub rejected the token. It may be mistyped or expired. Create a new one and paste it again.';
  if (status === 403 && headers.get('x-ratelimit-remaining') === '0')
    return 'GitHub rate limit reached. Sync will work again within an hour.';
  if (status === 403)
    return 'The token is not allowed to do this. Check it has “Contents: Read and write” access to this repository.';
  if (status === 404) return 'Repository not found, or the token has no access to it. Check the name and the token’s repository access.';
  if (status === 422 && /fast.?forward/i.test(detail)) return 'GitHub changed during sync.';
  return `GitHub error ${status}${detail ? `: ${detail}` : ''}`;
}
