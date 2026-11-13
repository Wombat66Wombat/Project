import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Note } from '../lib/types';
import { normalizeTitle } from '../lib/links';

interface Props {
  value: string;
  onChange: (value: string) => void;
  notes: Note[];
  selfId: string;
  autoFocus?: boolean;
  /** Called with the caret's 1-based line number (for live presence). */
  onCaret?: (line: number) => void;
  /** People in a live session, shown with the line they're on. */
  people?: { id: number; name: string; color: string; where: string }[];
}

interface Suggest {
  /** Index in `value` where the `[[` starts. */
  from: number;
  query: string;
  top: number;
  left: number;
}

/** Pixel position of the caret inside a textarea, via an off-screen mirror element. */
function caretCoords(el: HTMLTextAreaElement, pos: number): { top: number; left: number } {
  const style = getComputedStyle(el);
  const mirror = document.createElement('div');
  const props = [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize',
  ] as const;
  for (const p of props) mirror.style[p] = style[p];
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = el.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const top = marker.offsetTop - el.scrollTop + parseFloat(style.lineHeight || '20');
  const left = Math.min(marker.offsetLeft, el.clientWidth - 240);
  document.body.removeChild(mirror);
  return { top, left: Math.max(0, left) };
}

/**
 * Where position `pos` in `from` ends up in `to`, assuming one contiguous change in between
 * (true for each remote edit we apply). Positions before the change stay, ones after shift.
 */
export function mapPosition(from: string, to: string, pos: number): number {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from[start] === to[start]) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
    endFrom--;
    endTo--;
  }
  if (pos <= start) return pos;
  if (pos >= endFrom) return pos + (to.length - from.length);
  return endTo; // inside the replaced range: put it after the new text
}

/** A textarea that suggests note titles after you type `[[`. */
export function LinkEditor({ value, onChange, notes, selfId, autoFocus, onCaret, people = [] }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const [active, setActive] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  /** The text as this textarea last showed it, and the selection in it, to keep the caret in place when someone else edits. */
  const shown = useRef(value);
  const sel = useRef({ start: 0, end: 0 });

  // Grow with content so the page scrolls, not the textarea. Collapsing to measure would make
  // the scrolling container jump, so its scroll position is restored afterwards.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The text changed from outside (a collaborator, sync): keep the caret where it was in the text.
    if (value !== shown.current && document.activeElement === el && pendingCaret.current === null) {
      const map = (pos: number) => mapPosition(shown.current, value, pos);
      el.setSelectionRange(map(sel.current.start), map(sel.current.end));
    }
    shown.current = value;
    const scroller = el.closest('.main');
    const top = scroller?.scrollTop ?? 0;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 240)}px`;
    if (scroller) scroller.scrollTop = top;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const options = useMemo(() => {
    if (!suggest) return [];
    const q = normalizeTitle(suggest.query);
    const scored = notes
      .filter((n) => n.id !== selfId && n.title.trim())
      .map((n) => {
        const t = normalizeTitle(n.title);
        const score = !q ? 1 : t.startsWith(q) ? 0 : t.includes(q) ? 1 : -1;
        return { title: n.title, score, updated: n.updatedAt };
      })
      .filter((o) => o.score >= 0)
      .sort((a, b) => a.score - b.score || b.updated - a.updated)
      .slice(0, 7)
      .map((o) => ({ title: o.title, isNew: false }));
    const exact = notes.some((n) => normalizeTitle(n.title) === q);
    if (q && !exact) scored.push({ title: suggest.query.trim(), isNew: true });
    return scored;
  }, [suggest, notes, selfId]);

  function refresh(el: HTMLTextAreaElement) {
    const pos = el.selectionStart;
    onCaret?.(el.value.slice(0, pos).split('\n').length);
    if (pos !== el.selectionEnd) return setSuggest(null);
    const m = /\[\[([^\[\]|\n]{0,80})$/.exec(el.value.slice(0, pos));
    if (!m) return setSuggest(null);
    const from = pos - m[0].length;
    setSuggest({ from, query: m[1], ...caretCoords(el, pos) });
    setActive(0);
  }

  function pick(title: string) {
    const el = ref.current;
    if (!el || !suggest) return;
    const pos = el.selectionStart;
    const closing = value.slice(pos).startsWith(']]') ? 2 : 0;
    const insert = `[[${title}]]`;
    setSuggest(null);
    el.focus();
    // insertText keeps the browser's undo history (Ctrl/⌘+Z) intact; fall back to setting the value.
    el.setSelectionRange(suggest.from, pos + closing);
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, insert);
    if (!ok || el.value === value) {
      pendingCaret.current = suggest.from + insert.length;
      onChange(value.slice(0, suggest.from) + insert + value.slice(pos + closing));
    }
  }

  const editing = people.filter((p) => p.where.startsWith('editing'));
  return (
    <div className="editor-wrap">
      {editing.length > 0 && (
        <div className="live-where" aria-live="polite">
          {editing.map((p) => (
            <span key={p.id} className="where-chip" style={{ borderColor: p.color }}>
              <span className="avatar" style={{ background: p.color }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              {p.name} is {p.where}
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="editor"
        value={value}
        autoFocus={autoFocus}
        spellCheck
        placeholder="Write something… type [[ to link another note."
        aria-label="Note text"
        onChange={(e) => {
          shown.current = e.target.value;
          sel.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
          onChange(e.target.value);
          refresh(e.target);
        }}
        onSelect={(e) => (sel.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
        onClick={(e) => refresh(e.currentTarget)}
        onKeyUp={(e) => (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') && refresh(e.currentTarget)}
        onBlur={() => setTimeout(() => setSuggest(null), 120)}
        onKeyDown={(e) => {
          if (!suggest || options.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % options.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + options.length) % options.length);
          } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            pick(options[active].title);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setSuggest(null);
          }
        }}
      />
      {suggest && options.length > 0 && (
        <ul className="suggest" role="listbox" style={{ top: suggest.top + 4, left: suggest.left }}>
          {options.map((o, i) => (
            <li
              key={(o.isNew ? 'new:' : '') + o.title}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o.title);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {o.isNew ? (
                <>
                  <span className="suggest-new">New</span> {o.title}
                </>
              ) : (
                o.title
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
