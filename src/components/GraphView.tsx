import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { GraphIndex, Note } from '../lib/types';
import { navigate, noteHref } from '../lib/router';

interface GNode extends SimulationNodeDatum {
  id: string;
  title: string;
  degree: number;
  r: number;
}
type GLink = SimulationLinkDatum<GNode> & { source: GNode | string; target: GNode | string };

interface Props {
  notes: Note[];
  index: GraphIndex;
}

function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Force-directed map of all notes. Drag nodes, drag background to pan, scroll/pinch to zoom, click to open. */
export function GraphView({ notes, index }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverTitle, setHoverTitle] = useState<string | null>(null);

  const { nodes, links } = useMemo(() => {
    const ns: GNode[] = notes.map((n) => {
      const degree = (index.outgoing.get(n.id)?.size ?? 0) + (index.backlinks.get(n.id)?.size ?? 0);
      return { id: n.id, title: n.title || 'Untitled', degree, r: 5 + Math.sqrt(degree) * 3 };
    });
    const ls: GLink[] = [];
    for (const [from, tos] of index.outgoing) for (const to of tos) ls.push({ source: from, target: to });
    return { nodes: ns, links: ls };
  }, [notes, index]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let width = 0;
    let height = 0;
    let dpr = 1;
    const view = { x: 0, y: 0, k: 1 };
    let hover: GNode | null = null;
    let drag: { node: GNode | null; startX: number; startY: number; vx: number; vy: number; moved: boolean } | null = null;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    const neighbors = new Map<string, Set<string>>();
    for (const n of nodes) neighbors.set(n.id, new Set());
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      neighbors.get(s)?.add(t);
      neighbors.get(t)?.add(s);
    }

    const sim = forceSimulation<GNode>(nodes)
      .force('link', forceLink<GNode, GLink>(links).id((d) => d.id).distance(70).strength(0.6))
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.04))
      .force('y', forceY(0).strength(0.04))
      .force('collide', forceCollide<GNode>((d) => d.r + 4))
      .stop();
    // Settle the layout before the first frame so it doesn't explode outwards, then zoom to fit.
    sim.tick(Math.min(300, 60 + nodes.length));
    let fitted = false;
    sim.on('tick', draw).restart();

    function resize() {
      const rect = wrap.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      if (!fitted && width > 0) {
        fit();
        fitted = true;
      }
      draw();
    }

    function fit() {
      if (nodes.length === 0) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x! - n.r); x1 = Math.max(x1, n.x! + n.r);
        y0 = Math.min(y0, n.y! - n.r); y1 = Math.max(y1, n.y! + n.r + 18);
      }
      const pad = 60;
      const k = Math.min(1.8, Math.max(0.2, Math.min((width - pad * 2) / (x1 - x0 || 1), (height - pad * 2) / (y1 - y0 || 1))));
      view.k = k;
      view.x = -((x0 + x1) / 2) * k;
      view.y = -((y0 + y1) / 2) * k;
    }

    function toWorld(px: number, py: number) {
      return { x: (px - width / 2 - view.x) / view.k, y: (py - height / 2 - view.y) / view.k };
    }

    function nodeAt(px: number, py: number): GNode | null {
      const p = toWorld(px, py);
      let best: GNode | null = null;
      let bestD = Infinity;
      for (const n of nodes) {
        const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y);
        if (d < n.r + 6 / view.k && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    function draw() {
      const c = {
        bg: cssVar(wrap, '--surface'),
        edge: cssVar(wrap, '--graph-edge'),
        node: cssVar(wrap, '--accent'),
        dim: cssVar(wrap, '--graph-dim'),
        text: cssVar(wrap, '--text'),
        halo: cssVar(wrap, '--surface'),
      };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.translate(width / 2 + view.x, height / 2 + view.y);
      ctx.scale(view.k, view.k);

      const focus = hover ? neighbors.get(hover.id)! : null;
      const lit = (id: string) => !hover || id === hover.id || focus!.has(id);

      ctx.lineWidth = 1.2 / view.k;
      for (const l of links) {
        const s = l.source as GNode;
        const t = l.target as GNode;
        const on = !hover || s.id === hover.id || t.id === hover.id;
        ctx.strokeStyle = on && hover ? c.node : c.edge;
        ctx.globalAlpha = on ? 1 : 0.25;
        ctx.beginPath();
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of nodes) {
        ctx.fillStyle = lit(n.id) ? c.node : c.dim;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels: always for hovered + neighbours, otherwise only when zoomed in enough or for hubs.
      ctx.font = `${12 / view.k}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineJoin = 'round';
      for (const n of nodes) {
        const show = hover ? lit(n.id) : view.k > 0.9 || n.degree >= 3 || nodes.length < 40;
        if (!show) continue;
        const label = n.title.length > 32 ? n.title.slice(0, 31) + '…' : n.title;
        const y = n.y! + n.r + 3 / view.k;
        ctx.lineWidth = 3 / view.k;
        ctx.strokeStyle = c.halo;
        ctx.strokeText(label, n.x!, y);
        ctx.fillStyle = c.text;
        ctx.globalAlpha = lit(n.id) ? 1 : 0.4;
        ctx.fillText(label, n.x!, y);
        ctx.globalAlpha = 1;
      }
    }

    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    function onDown(e: PointerEvent) {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        drag = null;
        return;
      }
      const node = nodeAt(p.x, p.y);
      drag = { node, startX: p.x, startY: p.y, vx: view.x, vy: view.y, moved: false };
      if (node) {
        node.fx = node.x;
        node.fy = node.y;
        sim.alphaTarget(0.25).restart();
      }
    }

    function onMove(e: PointerEvent) {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        return;
      }
      if (drag) {
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4) drag.moved = true;
        if (drag.node) {
          const w = toWorld(p.x, p.y);
          drag.node.fx = w.x;
          drag.node.fy = w.y;
        } else {
          view.x = drag.vx + (p.x - drag.startX);
          view.y = drag.vy + (p.y - drag.startY);
          draw();
        }
        return;
      }
      const h = nodeAt(p.x, p.y);
      if (h !== hover) {
        hover = h;
        canvas.style.cursor = h ? 'pointer' : 'grab';
        setHoverTitle(h?.title ?? null);
        draw();
      }
    }

    function onUp(e: PointerEvent) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (!drag) return;
      const { node, moved } = drag;
      drag = null;
      if (node) {
        node.fx = null;
        node.fy = null;
        sim.alphaTarget(0);
        if (!moved) navigate(noteHref(node.id));
      }
    }

    function zoomAt(px: number, py: number, factor: number) {
      const k = Math.min(4, Math.max(0.2, view.k * factor));
      const f = k / view.k;
      const cx = px - width / 2;
      const cy = py - height / 2;
      view.x = cx - (cx - view.x) * f;
      view.y = cy - (cy - view.y) * f;
      view.k = k;
      draw();
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    }

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', draw);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    resize();

    return () => {
      sim.stop();
      ro.disconnect();
      mq.removeEventListener('change', draw);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [nodes, links]);

  const linkCount = links.length;
  return (
    <section className="graph">
      <div className="graph-head">
        <h1>Graph</h1>
        <span className="muted small">
          {notes.length} notes · {linkCount} links · drag to move, scroll to zoom, click to open
        </span>
      </div>
      <div className="graph-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} role="img" aria-label={`Graph of ${notes.length} notes and ${linkCount} links`} />
        {hoverTitle && <div className="graph-tip">{hoverTitle}</div>}
        {notes.length === 0 && <p className="graph-empty muted">No notes yet.</p>}
      </div>
    </section>
  );
}
