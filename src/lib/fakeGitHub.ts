/**
 * In-memory stand-in for the parts of the GitHub REST API that sync uses.
 * Test-only: lets the sync engine be exercised end to end without a network or a real token.
 */
import { fromBase64, gitBlobSha, toBase64 } from './noteFile';

interface Commit {
  tree: string;
  parent: string | null;
}

export class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Map<string, string>>();
  commits = new Map<string, Commit>();
  head: string | null = null;
  token = 'good-token';
  isPrivate = true;
  requests: string[] = [];
  /** Called just before the branch is moved; lets a test simulate another device pushing first. */
  beforeRefUpdate: (() => Promise<void>) | null = null;
  private n = 0;

  private id(kind: string) {
    return `${kind}${++this.n}`.padEnd(40, '0');
  }

  /** Current files as { path: content }. */
  snapshot(): Record<string, string> {
    if (!this.head) return {};
    const tree = this.trees.get(this.commits.get(this.head)!.tree)!;
    return Object.fromEntries([...tree].map(([p, sha]) => [p, this.blobs.get(sha)!]));
  }

  /** Commit files directly, as if edited on github.com. `null` deletes. */
  async edit(changes: Record<string, string | null>) {
    const tree = new Map(this.head ? this.trees.get(this.commits.get(this.head)!.tree)! : []);
    for (const [p, c] of Object.entries(changes)) {
      if (c === null) tree.delete(p);
      else {
        const sha = await gitBlobSha(c);
        this.blobs.set(sha, c);
        tree.set(p, sha);
      }
    }
    const t = this.id('t');
    this.trees.set(t, tree);
    const c = this.id('c');
    this.commits.set(c, { tree: t, parent: this.head });
    this.head = c;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    this.requests.push(`${method} ${path}`);
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${this.token}`) return json(401, { message: 'Bad credentials' });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;

    if (method === 'GET' && path === '') return json(200, { default_branch: 'main', private: this.isPrivate, permissions: { push: true } });
    if (method === 'GET' && path === '/git/ref/heads/main') {
      return this.head ? json(200, { object: { sha: this.head } }) : json(409, { message: 'Git Repository is empty.' });
    }
    if (method === 'PUT' && path.startsWith('/contents/')) {
      await this.edit({ [decodeURIComponent(path.slice('/contents/'.length))]: fromBase64(body.content) });
      return json(201, {});
    }
    let m = /^\/git\/commits\/(\w+)$/.exec(path);
    if (method === 'GET' && m) return json(200, { tree: { sha: this.commits.get(m[1])!.tree } });
    m = /^\/git\/trees\/(\w+)$/.exec(path);
    if (method === 'GET' && m) {
      const tree = this.trees.get(m[1])!;
      return json(200, { truncated: false, tree: [...tree].map(([p, sha]) => ({ path: p, type: 'blob', sha })) });
    }
    m = /^\/git\/blobs\/(\w+)$/.exec(path);
    if (method === 'GET' && m) return json(200, { encoding: 'base64', content: toBase64(this.blobs.get(m[1])!) });
    if (method === 'POST' && path === '/git/trees') {
      const tree = new Map(this.trees.get(body.base_tree)!);
      for (const e of body.tree) {
        if (e.sha === null) tree.delete(e.path);
        else {
          const sha = await gitBlobSha(e.content);
          this.blobs.set(sha, e.content);
          tree.set(e.path, sha);
        }
      }
      const t = this.id('t');
      this.trees.set(t, tree);
      return json(201, { sha: t });
    }
    if (method === 'POST' && path === '/git/commits') {
      const c = this.id('c');
      this.commits.set(c, { tree: body.tree, parent: body.parents[0] });
      return json(201, { sha: c });
    }
    if (method === 'PATCH' && path === '/git/refs/heads/main') {
      if (this.beforeRefUpdate) {
        const f = this.beforeRefUpdate;
        this.beforeRefUpdate = null;
        await f();
      }
      if (this.commits.get(body.sha)!.parent !== this.head) return json(422, { message: 'Update is not a fast forward' });
      this.head = body.sha;
      return json(200, {});
    }
    return json(404, { message: 'Not Found' });
  };
}
