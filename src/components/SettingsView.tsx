import { useEffect, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Pwa } from '../lib/pwa';
import type { Sync } from '../lib/useSync';
import type { Semantic } from '../lib/semantic/useSemantic';
import type { Live } from '../lib/live/useLive';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { relTime } from './SyncDialog';

interface Props {
  atlas: Atlas;
  pwa: Pwa;
  sync: Sync;
  semantic: Semantic;
  live: Live;
  onOpenSync: () => void;
  onOpenSmart: () => void;
  onInstall: () => void;
  onShortcuts: () => void;
  onTour: () => void;
  onExport: () => void;
  onRestore: () => void;
}

const mb = (b: number) => (b < 1e6 ? `${Math.max(1, Math.round(b / 1e3))} kB` : b < 1e9 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e9).toFixed(1)} GB`);

/** Everything adjustable in one place. */
export function SettingsView(p: Props) {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [name, setName] = useState(p.live.name);

  useEffect(() => setName(p.live.name), [p.live.name]);
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => e.usage !== undefined && e.quota && setUsage({ used: e.usage, quota: e.quota }));
    void navigator.storage?.persisted?.().then(setPersisted);
  }, [p.atlas.notes.length]);

  const choose = (t: Theme) => {
    setTheme(t);
    setThemeState(t);
  };

  return (
    <section className="screen settings">
      <h1>Settings</h1>

      <section className="set-group">
        <h2>Appearance</h2>
        <div className="set-row">
          <div>
            <strong>Theme</strong>
            <p className="muted small">“System” follows your device’s light or dark mode.</p>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''} onClick={() => choose(t)}>
                {t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="set-group">
        <h2>App</h2>
        <div className="set-row">
          <div>
            <strong>Install Atlas</strong>
            <p className="muted small">Open it like any other app, from your home screen or dock, in its own window.</p>
          </div>
          {p.pwa.installed ? (
            <span className="ok-text small">✓ Installed</span>
          ) : (
            <button className="btn" onClick={p.onInstall}>
              Install…
            </button>
          )}
        </div>
        <div className="set-row">
          <div>
            <strong>Works offline</strong>
            <p className="muted small">After the first visit, Atlas opens and works without internet. Sync and live sessions resume when you’re back online.</p>
          </div>
          <span className="small">{'serviceWorker' in navigator && navigator.serviceWorker.controller ? <span className="ok-text">✓ Ready</span> : <span className="muted">After the next reload</span>}</span>
        </div>
        {p.pwa.updateReady && (
          <div className="set-row">
            <div>
              <strong>Update available</strong>
              <p className="muted small">A newer version of Atlas has been downloaded.</p>
            </div>
            <button className="btn primary" onClick={p.pwa.update}>
              Update now
            </button>
          </div>
        )}
      </section>

      <section className="set-group">
        <h2>Your data</h2>
        <div className="set-row">
          <div>
            <strong>Stored on this device</strong>
            <p className="muted small">
              {p.atlas.notes.length} notes{usage ? ` · using ${mb(usage.used)} of the ${mb(usage.quota)} this browser allows` : ''}.
            </p>
          </div>
        </div>
        <div className="set-row">
          <div>
            <strong>Protect from automatic cleanup</strong>
            <p className="muted small">Browsers may clear a website’s data when the device runs low on space. This asks your browser to keep Atlas’s notes.</p>
          </div>
          {persisted ? (
            <span className="ok-text small">✓ Protected</span>
          ) : (
            <button
              className="btn"
              onClick={async () => {
                const ok = (await navigator.storage?.persist?.()) ?? false;
                setPersisted(ok);
                if (!ok) alert('Your browser declined for now. Installing Atlas, or using it often, usually makes it agree. Syncing to GitHub keeps a copy either way.');
              }}
            >
              Protect my notes
            </button>
          )}
        </div>
        <div className="set-row">
          <div>
            <strong>Sync with GitHub</strong>
            <p className="muted small">{p.sync.config ? `${p.sync.config.repo} · last synced ${relTime(p.sync.lastSyncAt)}` : 'Back up notes to a private repository and use them on all your devices.'}</p>
          </div>
          <button className="btn" onClick={p.onOpenSync}>
            {p.sync.config ? 'Manage…' : 'Set up…'}
          </button>
        </div>
        <div className="set-row">
          <div>
            <strong>Backup file</strong>
            <p className="muted small">Download all notes as one file, or restore from one.</p>
          </div>
          <div className="row-actions">
            <button className="btn" onClick={p.onExport}>
              Export
            </button>
            <button className="btn ghost" onClick={p.onRestore}>
              Restore…
            </button>
          </div>
        </div>
      </section>

      <section className="set-group">
        <h2>Smart features</h2>
        <div className="set-row">
          <div>
            <strong>Smart search</strong>
            <p className="muted small">
              {p.semantic.settings.enabled ? `On · ${p.semantic.model.label}` : 'Off'}. Find notes by meaning, on your device.
            </p>
          </div>
          <button className="btn" onClick={p.onOpenSmart}>
            {p.semantic.settings.enabled ? 'Manage…' : 'Turn on…'}
          </button>
        </div>
        <div className="set-row">
          <div>
            <strong>Your name in live sessions</strong>
            <p className="muted small">Shown to people you edit notes with.</p>
          </div>
          <input
            className="set-input"
            value={name}
            aria-label="Your name in live sessions"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => p.live.setName(name)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </div>
      </section>

      <section className="set-group">
        <h2>Help</h2>
        <div className="set-row">
          <div>
            <strong>Welcome tour</strong>
            <p className="muted small">A one-minute walk through what Atlas can do.</p>
          </div>
          <button className="btn" onClick={p.onTour}>
            Show tour
          </button>
        </div>
        <div className="set-row">
          <div>
            <strong>Keyboard shortcuts</strong>
            <p className="muted small">
              Press <kbd>?</kbd> anywhere to see them.
            </p>
          </div>
          <button className="btn" onClick={p.onShortcuts}>
            Show shortcuts
          </button>
        </div>
      </section>

      <p className="muted small about">
        Atlas · version {__APP_VERSION__} · free and open, runs on your device. Your notes never leave it unless you turn on sync or start a live
        session.
      </p>
    </section>
  );
}
