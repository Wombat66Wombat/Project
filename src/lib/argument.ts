import type { GraphIndex } from './types';

export type Role = 'focus' | 'reason' | 'objection' | 'rebuttal' | 'evidence';

export interface ArgNode {
  id: string;
  role: Role;
  children: ArgNode[];
  /** True when this note already appears higher up this branch (the branch stops here). */
  repeat?: boolean;
}

/*
 * Relationships come from typed-link fields (see fields.ts):
 *   A supports:: [[B]]     A is a reason for B
 *   A contradicts:: [[B]]  A is an objection to B
 *   A rebuts:: [[B]]       A answers the objection B
 *   A evidence:: [[S]]     S backs A (so does A source:: [[S]], e.g. a quote's source)
 */
const into = (ix: GraphIndex, id: string, type: string) => (ix.typedIn.get(id) ?? []).filter((l) => l.type === type).map((l) => l.from);
const outOf = (ix: GraphIndex, id: string, types: string[]) => (ix.typed.get(id) ?? []).filter((l) => types.includes(l.type)).map((l) => l.to);

export const reasonsFor = (ix: GraphIndex, id: string) => into(ix, id, 'supports');
export const objectionsTo = (ix: GraphIndex, id: string) => into(ix, id, 'contradicts');
export const rebuttalsOf = (ix: GraphIndex, id: string) => into(ix, id, 'rebuts');
export const evidenceOf = (ix: GraphIndex, id: string) => [...new Set(outOf(ix, id, ['evidence', 'source']))];
/** What a note argues for, and against. */
export const conclusionsOf = (ix: GraphIndex, id: string) => outOf(ix, id, ['supports']);
export const targetsOf = (ix: GraphIndex, id: string) => outOf(ix, id, ['contradicts', 'rebuts']);

/** The argument around a note: reasons and objections (with their own reasons, answers and evidence). */
export function buildArgument(ix: GraphIndex, focus: string, depth = 3): ArgNode {
  const make = (id: string, role: Role, path: Set<string>, level: number): ArgNode => {
    if (path.has(id)) return { id, role, children: [], repeat: true };
    const next = new Set(path).add(id);
    const children: ArgNode[] = [];
    if (role !== 'evidence') {
      for (const e of evidenceOf(ix, id)) children.push(make(e, 'evidence', next, level + 1));
      if (level < depth) {
        for (const r of reasonsFor(ix, id)) children.push(make(r, 'reason', next, level + 1));
        for (const o of objectionsTo(ix, id)) children.push(make(o, 'objection', next, level + 1));
        for (const b of rebuttalsOf(ix, id)) children.push(make(b, 'rebuttal', next, level + 1));
      }
    }
    return { id, role, children };
  };
  return make(focus, 'focus', new Set(), 0);
}

export type WeakKind = 'unsupported' | 'single-source' | 'unanswered' | 'circular' | 'disputed-evidence';

export interface WeakPoint {
  kind: WeakKind;
  /** The note the problem is about. */
  noteId: string;
  /** Other notes involved (the lone source, the objection, the cycle…). */
  related: string[];
}

/** All the sources a claim ultimately rests on: its own evidence and its reasons' evidence. */
export function sourcesBehind(ix: GraphIndex, id: string, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (seen.has(id)) return out;
  seen.add(id);
  for (const e of evidenceOf(ix, id)) out.add(e);
  for (const r of reasonsFor(ix, id)) for (const s of sourcesBehind(ix, r, seen)) out.add(s);
  return out;
}

/** A cycle of `supports` links through `id`, as a list of note ids, or null. */
export function supportCycle(ix: GraphIndex, id: string): string[] | null {
  const stack: string[] = [];
  const onPath = new Set<string>();
  const done = new Set<string>();
  const dfs = (n: string): string[] | null => {
    if (onPath.has(n)) return n === id ? [...stack, n] : null;
    if (done.has(n)) return null;
    onPath.add(n);
    stack.push(n);
    for (const c of conclusionsOf(ix, n)) {
      const found = dfs(c);
      if (found) return found;
    }
    stack.pop();
    onPath.delete(n);
    done.add(n);
    return null;
  };
  return dfs(id);
}

/** Weak spots in the argument shown for `root`. */
export function weakPoints(ix: GraphIndex, root: ArgNode): WeakPoint[] {
  const out: WeakPoint[] = [];
  const key = new Set<string>();
  const add = (w: WeakPoint) => {
    const k = `${w.kind}|${w.noteId}|${w.related.join(',')}`;
    if (!key.has(k)) {
      key.add(k);
      out.push(w);
    }
  };
  const visit = (n: ArgNode) => {
    if (n.repeat) return;
    if (n.role === 'evidence') {
      const against = objectionsTo(ix, n.id).filter((o) => rebuttalsOf(ix, o).length === 0);
      if (against.length) add({ kind: 'disputed-evidence', noteId: n.id, related: against });
      return;
    }
    const reasons = reasonsFor(ix, n.id);
    const evidence = evidenceOf(ix, n.id);
    // Rebuttals and objections are judged too, but a bare objection is still worth answering.
    if (reasons.length === 0 && evidence.length === 0) add({ kind: 'unsupported', noteId: n.id, related: [] });
    // Several lines of support that all lead back to one source look stronger than they are.
    const sources = sourcesBehind(ix, n.id);
    if (sources.size === 1 && reasons.length + evidence.length >= 2) add({ kind: 'single-source', noteId: n.id, related: [...sources] });
    for (const o of objectionsTo(ix, n.id)) if (rebuttalsOf(ix, o).length === 0) add({ kind: 'unanswered', noteId: n.id, related: [o] });
    const cycle = supportCycle(ix, n.id);
    if (cycle) add({ kind: 'circular', noteId: n.id, related: cycle });
    n.children.forEach(visit);
  };
  visit(root);
  // One report per cycle, not one per note in it.
  const cycles = new Set<string>();
  return out.filter((w) => {
    if (w.kind !== 'circular') return true;
    const k = [...new Set(w.related)].sort().join(',');
    if (cycles.has(k)) return false;
    cycles.add(k);
    return true;
  });
}
