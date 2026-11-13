import { useEffect, useRef, useState } from 'react';
import type { Sync } from '../lib/useSync';
import { parseRepo } from '../lib/github';
import { normalizeFolder } from '../lib/sync';

interface Props {
  sync: Sync;
  onClose: () => void;
}

export function relTime(t: number | null): string {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleString();
}

/** Settings for syncing notes to a private GitHub repository, with step-by-step setup help. */
export function SyncDialog({ sync, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const cfg = sync.config;
  const [repo, setRepo] = useState(cfg?.repo ?? '');
  const [folder, setFolder] = useState(cfg?.folder ?? 'notes');
  const [branch, setBranch] = useState(cfg?.branch ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(!cfg);

  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const repoOk = !!parseRepo(repo);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!repoOk) return setError('Repository should look like “your-name/atlas-notes”.');
    const t = token.trim() || cfg?.token || '';
    if (!t) return setError('Paste your token first.');
    const r = parseRepo(repo)!;
    setBusy(true);
    try {
      await sync.connect({ repo: `${r.owner}/${r.name}`, folder: normalizeFolder(folder), branch: branch.trim(), token: t });
      setToken('');
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Stop syncing on this device? Your notes stay here and on GitHub; the token is removed from this browser.')) return;
    await sync.disconnect();
    setToken('');
    setEditing(true);
  }

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="sync-title" onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id="sync-title">Sync with GitHub</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        {cfg && !editing ? (
          <>
            <div className={`sync-card ${sync.status}`}>
              <div>
                <strong>{cfg.repo}</strong>
                <span className="muted"> / {cfg.folder}</span>
              </div>
              <div className="small">
                {sync.status === 'syncing' && 'Syncing…'}
                {sync.status === 'synced' && `Last synced ${relTime(sync.lastSyncAt)}`}
                {sync.status === 'offline' && 'Offline. Will sync when you’re back online.'}
                {sync.status === 'error' && <span className="error">{sync.error}</span>}
              </div>
            </div>
            <p className="muted small">
              Atlas syncs when you open it, about 20 seconds after you stop typing, and every few minutes. Each note is a
              Markdown file in <code>{cfg.folder}/</code>, so GitHub keeps the full history of every change.
            </p>
            <div className="dialog-actions">
              <button className="btn danger ghost" onClick={disconnect}>
                Disconnect
              </button>
              <span className="spacer" />
              <button className="btn" onClick={() => setEditing(true)}>
                Change settings
              </button>
              <button className="btn primary" disabled={sync.status === 'syncing'} onClick={() => void sync.syncNow()}>
                Sync now
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="muted small">
              Keep your notes in a private GitHub repository: backed up, with full history, and the same on all your devices.
              Free. Takes about 3 minutes the first time.
            </p>

            <details className="steps" open={!cfg}>
              <summary>Setup steps</summary>
              <ol>
                <li>
                  <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">
                    Create a new repository
                  </a>{' '}
                  named e.g. <code>atlas-notes</code>. Choose <strong>Private</strong>. Nothing else is needed.
                </li>
                <li>
                  <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">
                    Create a fine-grained token
                  </a>
                  :
                  <ul>
                    <li>Token name: <code>Atlas</code>. Expiration: up to 1 year (you can make a new one later).</li>
                    <li>
                      Repository access: <strong>Only select repositories</strong> → pick <code>atlas-notes</code>.
                    </li>
                    <li>
                      Permissions → Repository permissions → <strong>Contents</strong> → <strong>Read and write</strong>.
                    </li>
                    <li>
                      Click <strong>Generate token</strong> and copy it (it starts with <code>github_pat_</code>).
                    </li>
                  </ul>
                </li>
                <li>Fill in the form below and click Connect.</li>
              </ol>
            </details>

            <label className="field">
              <span>Repository</span>
              <input
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                placeholder="your-name/atlas-notes"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
            <label className="field">
              <span>Token</span>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={cfg ? 'Leave empty to keep the current token' : 'github_pat_…'}
                autoComplete="off"
                spellCheck={false}
                required={!cfg}
              />
              <small className="muted">
                Stored only in this browser and sent only to GitHub. It can only touch the repository you picked.
              </small>
            </label>
            <details className="advanced">
              <summary>Advanced</summary>
              <label className="field">
                <span>Folder</span>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="notes" spellCheck={false} />
              </label>
              <label className="field">
                <span>Branch</span>
                <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Default branch" spellCheck={false} />
              </label>
            </details>

            {error && (
              <p className="error small" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              {cfg && (
                <button type="button" className="btn ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              )}
              <span className="spacer" />
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Connecting…' : cfg ? 'Save and sync' : 'Connect'}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
