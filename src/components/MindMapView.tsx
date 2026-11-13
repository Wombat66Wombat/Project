import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Note } from '../lib/types';
import { addChild, addSibling, deleteNode, findNode, label, layout, parseOutline, renameNode, type Edit, type MapNode, type Placed } from '../lib/mindmap';

interface Props {
  atlas: Atlas;
  note: Note;
}

const MAX_W = 240;
let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, root: boolean): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 8;
  measureCtx.font = root ? '600 16px system-ui, sans-serif' : '14px system-ui, sans-serif';
  return measureCtx.measureText(text).width;
}
const nodeWidth = (n: MapNode) => Math.min(MAX_W, Math.max(56, textWidth(label(n.text), n.kind === 'root') + (n.kind === 'root' ? 36 : 26)));
/** Shorten a label with "…" so it fits its box. */
function fit(n: MapNode, w: number): string {
  const full = label(n.text);
  const room = w - (n.kind === 'root' ? 36 : 26);
  if (textWidth(full, n.kind === 'root') <= room) return full;
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (textWidth(full.slice(0, mid) + '…', n.kind === 'root') <= room) lo = mid;
    else hi = mid - 1;
  }
  return full.slice(0, lo) + '…';
}

/**
 * The note's outline as a mind map. Every edit is written straight back into the note's
 * Markdown (headings and bullet lists), so the map and the text never disagree.
 */
export function MindMapView({ atlas, note }: Props) {
  const tree = useMemo(() => parseOutline(note.title, note.body), [note.title, note.body]);
  const placed = useMemo(() => layout(tree, nodeWidth), [tree]);
  const byId = useMemo(() => new Map(placed.map((p) => [p.node.id, p])), [placed]);
  const [selected, setSelected] = useState('root');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Keep the selection valid after edits (line numbers shift).
  useEffect(() => {
    if (!byId.has(selected)) setSelected('root');
  }, [byId, selected]);

  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  function fitView() {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of placed) {
      x0 = Math.min(x0, p.x - p.w / 2);
      x1 = Math.max(x1, p.x + p.w / 2);
      y0 = Math.min(y0, p.y - 20);
      y1 = Math.max(y1, p.y + 20);
    }
    const k = Math.min(1.2, Math.max(0.3, Math.min((size.w - 40) / (x1 - x0 || 1), (size.h - 40) / (y1 - y0 || 1))));
    setView({ k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k });
  }
  // Fit once the size is known, and when the tree grows beyond the view.
  const fitted = useRef(false);
  useEffect(() => {
    if (size.w > 0 && !fitted.current) {
      fitted.current = true;
      fitView();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  // Keep the selected idea on screen (e.g. after adding one at the edge of the map).
  useEffect(() => {
    const p = byId.get(selected);
    if (!p || !fitted.current || size.w === 0) return;
    const sx = p.x * view.k + view.x + size.w / 2;
    const sy = p.y * view.k + view.y + size.h / 2;
    const half = (p.w * view.k) / 2;
    const m = 24;
    let dx = 0;
    let dy = 0;
    if (sx - half < m) dx = m - (sx - half);
    else if (sx + half > size.w - m) dx = size.w - m - (sx + half);
    if (sy < 40) dy = 40 - sy;
    else if (sy > size.h - 40) dy = size.h - 40 - sy;
    if (dx || dy) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, placed]);

  function apply(edit: Edit | null, thenEdit = false) {
    if (!edit) return;
    atlas.updateBody(note.id, edit.body);
    setSelected(edit.select);
    if (thenEdit) {
      const fresh = findNode(parseOutline(note.title, edit.body), edit.select);
      if (fresh) setEditing({ id: edit.select, text: fresh.text });
    }
    box.current?.focus();
  }

  const sel = byId.get(selected)?.node ?? tree;
  const act = {
    child: () => apply(addChild(note.body, tree, sel.id), true),
    sibling: () => apply(sel.kind === 'root' ? addChild(note.body, tree, 'root') : addSibling(note.body, tree, sel.id), true),
    rename: () => sel.kind !== 'root' && setEditing({ id: sel.id, text: sel.text }),
    remove: () => {
      if (sel.kind === 'root') return;
      const n = sel.children.length;
      if (n && !confirm(`Delete “${label(sel.text)}” and the ${n} idea${n === 1 ? '' : 's'} under it?`)) return;
      apply(deleteNode(note.body, tree, sel.id));
    },
  };

  function move(key: string) {
    const p = byId.get(selected);
    if (!p) return;
    const n = p.node;
    const siblings = n.parent?.children ?? [];
    const i = siblings.indexOf(n);
    const towardChildren = (key === 'ArrowRight' && p.side === 1) || (key === 'ArrowLeft' && p.side === -1);
    let next: MapNode | undefined;
    if (n.kind === 'root') {
      next = n.children.find((c) => byId.get(c.id)?.side === (key === 'ArrowLeft' ? -1 : 1));
    } else if (key === 'ArrowUp') next = siblings[i - 1];
    else if (key === 'ArrowDown') next = siblings[i + 1];
    else if (towardChildren) next = n.children[0];
    else if (key === 'ArrowLeft' || key === 'ArrowRight') next = n.parent ?? undefined;
    if (next) setSelected(next.id);
  }

  function onKey(e: React.KeyboardEvent) {
    if (editing) return;
    const k = e.key;
    if (k === 'Tab') act.child();
    else if (k === 'Enter') act.sibling();
    else if (k === 'F2' || (k === ' ' && sel.kind !== 'root')) act.rename();
    else if (k === 'Delete' || k === 'Backspace') act.remove();
    else if (k.startsWith('Arrow')) move(k);
    else return;
    e.preventDefault();
  }

  function commitEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    setEditing(null);
    if (text) apply(renameNode(note.body, tree, editing.id, text));
    box.current?.focus();
  }

  const toScreen = (p: Placed) => ({ x: p.x * view.k + view.x + size.w / 2, y: p.y * view.k + view.y + size.h / 2 });
  const editP = editing ? byId.get(editing.id) : undefined;

  return (
    <div className="mindmap">
      <div className="mindmap-tools">
        <button className="btn small-btn" onClick={act.child} title="Add a child idea (Tab)">
          + Child
        </button>
        <button className="btn small-btn" onClick={act.sibling} title="Add an idea next to this one (Enter)">
          + Sibling
        </button>
        <button className="btn small-btn" onClick={act.rename} disabled={sel.kind === 'root'} title="Rename (F2 or double-click)">
          Rename
        </button>
        <button className="btn small-btn danger" onClick={act.remove} disabled={sel.kind === 'root'} title="Delete (Delete key)">
          Delete
        </button>
        <span className="spacer" />
        <button className="btn ghost small-btn" onClick={fitView}>
          Fit
        </button>
      </div>
      <div
        ref={box}
        className="mindmap-canvas"
        tabIndex={0}
        role="tree"
        aria-label={`Mind map of ${note.title}. Arrow keys move, Tab adds a child, Enter adds a sibling, F2 renames, Delete removes.`}
        onKeyDown={onKey}
        onWheel={(e) => {
          const r = box.current!.getBoundingClientRect();
          const px = e.clientX - r.left - size.w / 2;
          const py = e.clientY - r.top - size.h / 2;
          const k = Math.min(2.5, Math.max(0.2, view.k * Math.exp(-e.deltaY * 0.0015)));
          const f = k / view.k;
          setView({ k, x: px - (px - view.x) * f, y: py - (py - view.y) * f });
        }}
        onPointerDown={(e) => {
          if ((e.target as Element).closest('.mm-node, input')) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          if (drag.current) setView((v) => ({ ...v, x: drag.current!.vx + e.clientX - drag.current!.x, y: drag.current!.vy + e.clientY - drag.current!.y }));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <svg width={size.w || 1} height={size.h || 1}>
          <g transform={`translate(${view.x + size.w / 2},${view.y + size.h / 2}) scale(${view.k})`}>
            {placed.map((p) => {
              if (!p.node.parent) return null;
              const parent = byId.get(p.node.parent.id)!;
              const sx = parent.x + (parent.node.kind === 'root' ? p.side * parent.w / 2 : p.side * parent.w / 2);
              const ex = p.x - (p.side * p.w) / 2;
              const mx = (sx + ex) / 2;
              return (
                <path
                  key={`e${p.node.id}`}
                  className={`mm-edge b${p.branch % 6}`}
                  d={`M${sx},${parent.y} C${mx},${parent.y} ${mx},${p.y} ${ex},${p.y}`}
                />
              );
            })}
            {placed.map((p) => {
              const n = p.node;
              const h = n.kind === 'root' ? 40 : 30;
              return (
                <g
                  key={n.id}
                  className={`mm-node ${n.kind} b${p.branch % 6} ${selected === n.id ? 'sel' : ''}`}
                  transform={`translate(${p.x - p.w / 2},${p.y - h / 2})`}
                  role="treeitem"
                  aria-selected={selected === n.id}
                  onClick={() => {
                    setSelected(n.id);
                    box.current?.focus();
                  }}
                  onDoubleClick={() => n.kind !== 'root' && setEditing({ id: n.id, text: n.text })}
                >
                  <title>{label(n.text)}</title>
                  <rect width={p.w} height={h} rx={n.kind === 'root' ? 12 : 8} />
                  <text x={p.w / 2} y={h / 2} dominantBaseline="central" textAnchor="middle">
                    {fit(n, p.w)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        {editing && editP && (
          <input
            className="mm-input"
            autoFocus
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') {
                setEditing(null);
                box.current?.focus();
              }
              e.stopPropagation();
            }}
            style={{
              left: toScreen(editP).x - Math.max(editP.w, 180) / 2,
              top: toScreen(editP).y - 17,
              width: Math.max(editP.w, 180),
            }}
            aria-label="Idea text"
          />
        )}
        {tree.children.length === 0 && (
          <p className="mm-empty muted small">This note has no headings or bullet points yet. Press Tab or “+ Child” to start the map.</p>
        )}
      </div>
    </div>
  );
}
