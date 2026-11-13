import { useEffect, useRef, useState } from 'react';
import type { Semantic } from '../lib/semantic/useSemantic';
import { MODELS, type ModelKey } from '../lib/semantic/models';

interface Props {
  semantic: Semantic;
  onClose: () => void;
}

const mb = (bytes: number) => (bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0);

/** Turn smart search on/off, pick the language model, and see download/indexing progress. */
export function SmartSearchDialog({ semantic, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState<ModelKey>(semantic.settings.model);
  const on = semantic.settings.enabled;

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

  const switching = on && choice !== semantic.settings.model;

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="smart-title" onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id="smart-title">Smart search</h2>
          <button className="btn ghost icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted small">
          Find notes by <strong>meaning</strong>, not just exact words: searching “can’t sleep” also finds a note about insomnia.
          Each note also shows <strong>related notes</strong> you haven’t linked yet.
        </p>
        <p className="muted small">
          It runs entirely on this device: your notes and searches never leave it. The model is downloaded once, free,
          from Hugging Face (a public library of AI models), then works offline.
        </p>

        <fieldset className="choices">
          <legend>Language of your notes</legend>
          {(Object.keys(MODELS) as ModelKey[]).map((k) => (
            <label key={k} className={`choice ${choice === k ? 'on' : ''}`}>
              <input type="radio" name="model" value={k} checked={choice === k} onChange={() => setChoice(k)} />
              <span>
                <strong>{MODELS[k].label}</strong> <span className="muted small">· {MODELS[k].sizeMB} MB download</span>
                <br />
                <span className="muted small">{MODELS[k].description}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {on && (
          <div className={`sync-card ${semantic.status === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
            {semantic.status === 'loading' && (
              <>
                <span>
                  {semantic.download
                    ? `Downloading the model… ${mb(semantic.download.loaded)} / ${mb(semantic.download.total)} MB`
                    : 'Starting the model…'}
                </span>
                <progress
                  max={semantic.download?.total || 1}
                  value={semantic.download ? semantic.download.loaded : undefined}
                  aria-label="Download progress"
                />
              </>
            )}
            {semantic.status === 'indexing' && (
              <>
                <span>
                  Reading your notes… {semantic.indexed} / {semantic.total}
                </span>
                <progress max={semantic.total || 1} value={semantic.indexed} aria-label="Indexing progress" />
              </>
            )}
            {semantic.status === 'ready' && (
              <span>
                ✓ Ready · {semantic.total} note{semantic.total === 1 ? '' : 's'} understood ({semantic.model.label})
              </span>
            )}
            {semantic.status === 'error' && (
              <span className="error">
                {semantic.error}{' '}
                <button className="linklike" onClick={semantic.retry}>
                  Try again
                </button>
              </span>
            )}
          </div>
        )}

        <div className="dialog-actions">
          {on && (
            <button
              className="btn ghost danger"
              onClick={() => {
                if (confirm('Turn off smart search? This also deletes the downloaded model to free space.')) void semantic.disable();
              }}
            >
              Turn off
            </button>
          )}
          <span className="spacer" />
          {!on && (
            <button className="btn primary" onClick={() => void semantic.enable(choice)}>
              Turn on ({MODELS[choice].sizeMB} MB)
            </button>
          )}
          {switching && (
            <button className="btn primary" onClick={() => void semantic.enable(choice)}>
              Switch to {MODELS[choice].label}
            </button>
          )}
          {on && !switching && (
            <button className="btn" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
