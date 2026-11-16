import { useState } from 'react';
import { Dialog } from './Dialog';
import { SHORTCUTS } from '../lib/shortcuts';
import type { Pwa } from '../lib/pwa';

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} wide>
      <div className="shortcut-groups">
        {SHORTCUTS.map((g) => (
          <section key={g.group}>
            <h3>{g.group}</h3>
            <dl>
              {g.items.map((s) => (
                <div key={s.keys} className="shortcut">
                  <dt>
                    {s.keys.split('  or  ').map((part, i) => (
                      <span key={i}>
                        {i > 0 && <span className="muted"> or </span>}
                        {part.split(' ').map((key, j) => (
                          <kbd key={j}>{key}</kbd>
                        ))}
                      </span>
                    ))}
                  </dt>
                  <dd>{s.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** Install instructions: the browser's own prompt where there is one, otherwise steps per platform. */
export function InstallDialog({ pwa, onClose }: { pwa: Pwa; onClose: () => void }) {
  const [result, setResult] = useState('');
  return (
    <Dialog title="Install Atlas" onClose={onClose}>
      <p className="muted small">Installed, Atlas opens in its own window from your home screen or dock, works offline, and keeps your notes on this device.</p>
      {pwa.installed ? (
        <p className="ok-text">✓ Atlas is installed. You’re using the app right now.</p>
      ) : pwa.canInstall ? (
        <button
          className="btn primary"
          onClick={async () => {
            const ok = await pwa.install();
            setResult(ok ? 'Installed ✓ Look for Atlas on your home screen or in your apps.' : 'Not installed. You can do this any time from Settings.');
          }}
        >
          Install now
        </button>
      ) : pwa.ios ? (
        <ol className="install-steps">
          <li>
            Tap the <strong>Share</strong> button <span aria-hidden="true">(□↑)</span> in Safari’s toolbar.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong>. Atlas appears on your home screen.
          </li>
        </ol>
      ) : (
        <ul className="install-steps">
          <li>
            <strong>Chrome or Edge:</strong> click the install icon (⊕) at the right of the address bar, or the browser menu → <em>Install Atlas</em> / <em>Apps → Install this site</em>.
          </li>
          <li>
            <strong>Android:</strong> browser menu (⋮) → <em>Install app</em> or <em>Add to Home screen</em>.
          </li>
          <li>
            <strong>Safari on Mac:</strong> File → <em>Add to Dock</em>.
          </li>
          <li>
            <strong>Firefox:</strong> doesn’t install websites on desktop, but Atlas works the same in a tab.
          </li>
        </ul>
      )}
      {result && <p className="small">{result}</p>}
    </Dialog>
  );
}

const STEPS: { title: string; text: string; icon: string }[] = [
  { icon: '🗺️', title: 'Welcome to Atlas', text: 'Your notes, linked together. Type [[ and a title to link one note to another. Every note shows what links back to it, so ideas find each other.' },
  { icon: '🔭', title: 'Look at it from every angle', text: 'Views ▾ (top right) has the Graph of connections, a 3D City of your notes, Ask for answers with sources, plus Decisions and Recipes.' },
  { icon: '📥', title: 'Bring knowledge in', text: 'New ▾ has templates for decisions, claims and recipes. Views ▾ → Import turns PDFs, articles, YouTube transcripts and even your ChatGPT, Claude or email history into notes.' },
  { icon: '🧠', title: 'Think with it', text: 'Each note has tabs: Map turns it into an editable mind map, Argue shows reasons and objections and flags weak points, and Live lets you edit it together with someone.' },
  { icon: '🔒', title: 'Yours, private and free', text: 'Everything is saved on this device automatically. Turn on Sync to back up to your own GitHub, and Smart search to find notes by meaning. Install Atlas from Settings to use it like an app, even offline. Press ? for shortcuts.' },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <Dialog title={s.title} onClose={onClose}>
      <div className="tour">
        <div className="tour-icon" aria-hidden="true">
          {s.icon}
        </div>
        <p>{s.text}</p>
        <div className="tour-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((_, j) => (
            <span key={j} className={j === i ? 'on' : ''} />
          ))}
        </div>
        <div className="dialog-actions">
          <button className="btn ghost" onClick={onClose}>
            Skip
          </button>
          <span className="spacer" />
          {/* Always present (hidden on the first step) so the buttons never move between steps. */}
          <button className="btn" onClick={() => setI(i - 1)} style={{ visibility: i > 0 ? 'visible' : 'hidden' }} aria-hidden={i === 0} tabIndex={i === 0 ? -1 : 0}>
            Back
          </button>
          <button className="btn primary" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? 'Start exploring' : 'Next'}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
