import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Note } from '../lib/types';
import { keySentences } from '../lib/research/keypoints';
import { citeLabel, claimFromQuote } from '../lib/research/source';
import { uniqueTitle } from '../lib/links';
import { noteHref } from '../lib/router';

/** The heading (e.g. "Page 4", "12:30") above a DOM node inside the rendered note. */
function sectionOf(node: Node | null, root: HTMLElement): string {
  let el: Node | null = node;
  while (el && el.parentNode !== root) el = el.parentNode;
  for (let cur = el as Element | null; cur; cur = cur.previousElementSibling) {
    if (/^H[1-6]$/.test(cur.tagName)) return (cur.textContent ?? '').trim();
  }
  return '';
}

function useSaveClaim(atlas: Atlas, source: Note) {
  return (quote: string, section: string) => {
    const c = claimFromQuote(quote, source.title, section);
    return atlas.add(uniqueTitle(atlas.index.byTitle, c.title), c.body);
  };
}

/** A floating "Save as claim" button for text selected in a rendered source. */
export function SelectionToClaim({ atlas, note, proseRef }: { atlas: Atlas; note: Note; proseRef: RefObject<HTMLDivElement> }) {
  const [sel, setSel] = useState<{ text: string; section: string; top: number; left: number } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const save = useSaveClaim(atlas, note);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = proseRef.current;
    if (!root) return;
    const update = () => {
      const s = window.getSelection();
      const text = s?.toString().trim() ?? '';
      if (!s || s.rangeCount === 0 || text.split(/\s+/).length < 3 || !root.contains(s.anchorNode)) return setSel(null);
      const rect = s.getRangeAt(0).getBoundingClientRect();
      const host = root.offsetParent as HTMLElement | null;
      const base = host?.getBoundingClientRect() ?? { top: 0, left: 0 };
      setSel({
        text,
        section: sectionOf(s.anchorNode, root),
        top: rect.bottom - base.top + (host?.scrollTop ?? 0) + 6,
        left: Math.max(0, rect.left - base.left + rect.width / 2 - 70),
      });
      setSaved(null);
    };
    const later = () => setTimeout(update, 0);
    root.addEventListener('mouseup', later);
    root.addEventListener('keyup', later);
    root.addEventListener('touchend', later);
    const onDoc = (e: Event) => !box.current?.contains(e.target as Node) && !root.contains(e.target as Node) && setSel(null);
    document.addEventListener('pointerdown', onDoc);
    return () => {
      root.removeEventListener('mouseup', later);
      root.removeEventListener('keyup', later);
      root.removeEventListener('touchend', later);
      document.removeEventListener('pointerdown', onDoc);
    };
  }, [proseRef]);

  if (!sel && !saved) return null;
  return (
    <div ref={box} className="sel-pop" style={sel ? { top: sel.top, left: sel.left } : { display: 'none' }}>
      {saved ? (
        <a href={noteHref(saved)}>Saved ✓ open claim</a>
      ) : (
        <button
          className="btn primary small-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!sel) return;
            const n = save(sel.text, sel.section);
            setSaved(n.id);
            window.getSelection()?.removeAllRanges();
          }}
        >
          Save as claim{sel?.section ? ` (${citeLabel(sel.section)})` : ''}
        </button>
      )}
    </div>
  );
}

/** The sentences that best summarise a source, each one click away from becoming a claim. */
export function KeySentences({ atlas, note }: { atlas: Atlas; note: Note }) {
  const key = useMemo(() => keySentences(note, 5), [note]);
  const [saved, setSaved] = useState<Record<number, string>>({});
  const save = useSaveClaim(atlas, note);
  if (key.length === 0) return null;
  return (
    <section className="card keypoints">
      <h2>Key sentences</h2>
      <p className="muted small">Picked automatically as the sentences most connected to the rest of the text. Select any other passage to save it too.</p>
      <ol>
        {key.map((k, i) => (
          <li key={i}>
            <span>{k.text}</span>
            {k.section && <span className="muted small"> ({citeLabel(k.section)})</span>}{' '}
            {saved[i] ? (
              <a className="small" href={noteHref(saved[i])}>
                saved ✓
              </a>
            ) : (
              <button className="linklike small" onClick={() => setSaved((s) => ({ ...s, [i]: save(k.text, k.section).id }))}>
                save as claim
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
