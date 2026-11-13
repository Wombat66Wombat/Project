import { useEffect, useRef, useState } from 'react';
import type { Live } from '../lib/live/useLive';
import { inviteLink } from '../lib/live/useLive';
import type { Note } from '../lib/types';

interface Props {
  live: Live;
  note: Note;
}

/** The "Live" button and panel on a note: start a session, share the invite, see who's here. */
export function LivePanel({ live, note }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const state = live.stateFor(note.id);
  const rec = live.roomOf(note.id);
  const isLive = !!state;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const link = rec ? inviteLink(rec.roomId, note.title) : '';
  const others = state?.people ?? [];

  return (
    <div className="menu live" ref={ref}>
      <button
        className={`btn ghost live-btn ${isLive ? 'on' : ''}`}
        aria-expanded={open}
        aria-label={isLive ? `Live session, ${others.length} other ${others.length === 1 ? 'person' : 'people'}` : 'Start a live session'}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`live-dot ${state?.status ?? 'off'}`} aria-hidden="true" />
        Live
        {isLive && others.length > 0 && (
          <span className="avatars" aria-hidden="true">
            {others.slice(0, 3).map((p) => (
              <span key={p.id} className="avatar" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </span>
        )}
      </button>
      {open && (
        <div className="menu-pop live-pop" role="dialog" aria-label="Live session">
          {!isLive ? (
            <>
              <strong>Edit this note together, live</strong>
              <p className="muted small">
                Anyone with the invite link can edit the text and mind map with you in real time. Connections go directly
                between browsers and are encrypted; public relays only help you find each other. Free, no account.
              </p>
              <label className="field">
                <span>Your name</span>
                <input defaultValue={live.name} onBlur={(e) => live.setName(e.target.value)} />
              </label>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await live.start(note.id);
                  setBusy(false);
                }}
              >
                {busy ? 'Starting…' : rec ? 'Rejoin live session' : 'Start live session'}
              </button>
            </>
          ) : (
            <>
              <strong>{state.status === 'connecting' ? 'Connecting…' : others.length ? `Live with ${others.length}` : 'Live, waiting for others'}</strong>
              <label className="field">
                <span>Invite link</span>
                <div className="copy-row">
                  <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" />
                  <button
                    className="btn small-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {
                        /* the field is selectable as a fallback */
                      }
                    }}
                  >
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                </div>
              </label>
              <p className="muted small">Share it only with people you trust: anyone who has it can edit this note.</p>
              <label className="field">
                <span>Your name</span>
                <input defaultValue={live.name} onBlur={(e) => live.setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
              </label>
              <ul className="people">
                <li>
                  <span className="avatar" style={{ background: 'var(--accent)' }}>
                    {live.name.slice(0, 1).toUpperCase()}
                  </span>
                  {live.name} <span className="muted small">(you)</span>
                </li>
                {others.map((p) => (
                  <li key={p.id}>
                    <span className="avatar" style={{ background: p.color }}>
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    {p.name} <span className="muted small">· {p.where}</span>
                  </li>
                ))}
              </ul>
              <button className="btn ghost danger" onClick={() => live.leave(note.id)}>
                Leave session
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
