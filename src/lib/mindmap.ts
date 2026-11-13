/**
 * A note's outline (headings and bullet lists) as a tree, plus edits that write back to the
 * Markdown, so the mind map and the text are always the same thing.
 */
export interface MapNode {
  /** "root" or the line number of the heading/list item. */
  id: string;
  text: string;
  kind: 'root' | 'heading' | 'item';
  /** Heading level (1–6) or list indent (spaces). */
  level: number;
  line: number;
  /** Last line (inclusive) that belongs to this node and its descendants. */
  end: number;
  children: MapNode[];
  parent: MapNode | null;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const FIELD = /^\s*[A-Za-z][\w-]*::/;

const indentOf = (s: string) => s.replace(/\t/g, '  ').length;

/** Plain label for display: links and emphasis stripped. */
export function label(md: string): string {
  return md
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim();
}

export function parseOutline(title: string, body: string): MapNode {
  const lines = body.split('\n');
  const root: MapNode = { id: 'root', text: title || 'Untitled', kind: 'root', level: 0, line: -1, end: lines.length - 1, children: [], parent: null };
  const stack: MapNode[] = [root];
  let inCode = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) inCode = !inCode;
    if (inCode || FIELD.test(l)) return;
    const h = HEADING.exec(l);
    if (h) {
      const level = h[1].length;
      while (stack.length > 1 && !(stack[stack.length - 1].kind === 'heading' && stack[stack.length - 1].level < level)) stack.pop();
      const parent = stack[stack.length - 1];
      const node: MapNode = { id: String(i), text: h[2].trim(), kind: 'heading', level, line: i, end: i, children: [], parent };
      parent.children.push(node);
      stack.push(node);
      return;
    }
    const it = ITEM.exec(l);
    if (it) {
      const level = indentOf(it[1]);
      while (stack[stack.length - 1].kind === 'item' && stack[stack.length - 1].level >= level) stack.pop();
      const parent = stack[stack.length - 1];
      const node: MapNode = { id: String(i), text: it[3].trim(), kind: 'item', level, line: i, end: i, children: [], parent };
      parent.children.push(node);
      stack.push(node);
      return;
    }
    // A non-blank, non-indented line ends any open list.
    if (l.trim() && !/^\s/.test(l)) while (stack[stack.length - 1].kind === 'item') stack.pop();
  });
  // Section ends: a heading owns everything up to the next heading of the same or higher level.
  const headings: MapNode[] = [];
  const walk = (n: MapNode) => {
    if (n.kind === 'heading') headings.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  headings.forEach((hd, k) => {
    const next = headings.slice(k + 1).find((o) => o.level <= hd.level);
    let end = next ? next.line - 1 : lines.length - 1;
    while (end > hd.line && !lines[end].trim()) end--;
    hd.end = end;
  });
  // List items own their nested items (and continuation lines).
  const fixItems = (n: MapNode) => {
    n.children.forEach(fixItems);
    if (n.kind === 'item') n.end = Math.max(n.line, ...n.children.map((c) => c.end));
  };
  fixItems(root);
  return root;
}

export function findNode(root: MapNode, id: string): MapNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return null;
}

/** All nodes in display order (depth-first). */
export function flatten(root: MapNode): MapNode[] {
  const out: MapNode[] = [];
  const walk = (n: MapNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** Result of an edit: the new body and the id (line) of the node to select afterwards. */
export interface Edit {
  body: string;
  select: string;
}

function itemPrefix(lines: string[], n: MapNode): string {
  const m = ITEM.exec(lines[n.line]);
  const marker = m && /\d/.test(m[2]) ? '1.' : '-';
  return `${' '.repeat(n.level)}${marker} `;
}

export function renameNode(body: string, root: MapNode, id: string, text: string): Edit | null {
  const n = findNode(root, id);
  if (!n || n.kind === 'root') return null;
  const lines = body.split('\n');
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (n.kind === 'heading') lines[n.line] = `${'#'.repeat(n.level)} ${clean}`;
  else lines[n.line] = lines[n.line].replace(ITEM, (_, sp: string, mk: string) => `${sp}${mk} ${clean}`);
  return { body: lines.join('\n'), select: id };
}

/** Add a child at the end of a node's children. Headings and the root get list items. */
export function addChild(body: string, root: MapNode, id: string, text = 'New idea'): Edit | null {
  const n = findNode(root, id);
  if (!n) return null;
  const lines = body.split('\n');
  if (n.kind === 'item') {
    const at = n.end + 1;
    lines.splice(at, 0, `${' '.repeat(n.level + 2)}- ${text}`);
    return { body: lines.join('\n'), select: String(at) };
  }
  // Root or heading: add a list item after its own top-level items (before any sub-heading).
  const items = n.children.filter((c) => c.kind === 'item');
  const firstSub = n.children.find((c) => c.kind === 'heading');
  let at: number;
  if (items.length) at = items[items.length - 1].end + 1;
  else if (firstSub) at = firstSub.line;
  else at = n.kind === 'root' ? lines.length : n.end + 1;
  const indent = items.length ? items[0].level : 0;
  const insert = [`${' '.repeat(indent)}- ${text}`];
  // Keep a blank line between a list and a following heading, and after a heading or paragraph.
  const prev = lines[at - 1];
  if (at > 0 && prev !== undefined && prev.trim() && !ITEM.test(prev) && !HEADING.test(prev)) insert.unshift('');
  if (lines[at] !== undefined && HEADING.test(lines[at])) insert.push('');
  if (n.kind === 'root' && at === lines.length && lines.length === 1 && lines[0] === '') {
    return { body: insert[insert.length - 1], select: '0' };
  }
  lines.splice(at, 0, ...insert);
  return { body: lines.join('\n'), select: String(at + insert.indexOf(insert.find((l) => l.trim())!)) };
}

/** Add a sibling right after a node (and its descendants). */
export function addSibling(body: string, root: MapNode, id: string, text = 'New idea'): Edit | null {
  const n = findNode(root, id);
  if (!n || n.kind === 'root') return null;
  if (n.parent && n.kind === 'item') {
    const lines = body.split('\n');
    const at = n.end + 1;
    lines.splice(at, 0, `${itemPrefix(lines, n)}${text}`);
    return { body: lines.join('\n'), select: String(at) };
  }
  // Heading: a new heading of the same level after this section.
  const lines = body.split('\n');
  const at = n.end + 1;
  lines.splice(at, 0, '', `${'#'.repeat(n.level)} ${text}`);
  return { body: lines.join('\n'), select: String(at + 1) };
}

/** Remove a node with everything under it. */
export function deleteNode(body: string, root: MapNode, id: string): Edit | null {
  const n = findNode(root, id);
  if (!n || n.kind === 'root') return null;
  const lines = body.split('\n');
  const siblings = n.parent!.children;
  const idx = siblings.indexOf(n);
  lines.splice(n.line, n.end - n.line + 1);
  // Select the previous sibling, else the parent (line numbers before the cut are unchanged).
  const prev = siblings[idx - 1];
  const select = prev ? prev.id : n.parent!.id;
  return { body: lines.join('\n').replace(/\n{3,}/g, '\n\n'), select };
}

export interface Placed {
  node: MapNode;
  x: number;
  y: number;
  w: number;
  side: 1 | -1;
  branch: number;
}

/**
 * Balanced mind-map layout: the root in the middle, top-level branches split between the right
 * and left so both sides hold about the same number of leaves; each side is a tidy tree.
 */
export function layout(root: MapNode, measure: (n: MapNode) => number, gapX = 48, rowH = 40): Placed[] {
  const leaves = (n: MapNode): number => (n.children.length ? n.children.reduce((s, c) => s + leaves(c), 0) : 1);
  const total = root.children.reduce((s, c) => s + leaves(c), 0);
  const right: MapNode[] = [];
  const left: MapNode[] = [];
  let acc = 0;
  for (const c of root.children) {
    (acc < total / 2 || root.children.length === 1 ? right : left).push(c);
    acc += leaves(c);
  }
  const out: Placed[] = [{ node: root, x: 0, y: 0, w: measure(root), side: 1, branch: -1 }];
  const place = (nodes: MapNode[], side: 1 | -1, branchStart: number) => {
    const height = nodes.reduce((s, c) => s + leaves(c), 0) * rowH;
    let y = -height / 2;
    const rootHalf = measure(root) / 2;
    const rec = (n: MapNode, x: number, branch: number) => {
      const w = measure(n);
      const h = leaves(n) * rowH;
      const cx = x + (side * w) / 2;
      out.push({ node: n, x: cx, y: y + h / 2, w, side, branch });
      if (n.children.length) {
        const save = y;
        for (const c of n.children) rec(c, x + side * (w + gapX), branch);
        y = save + h;
      } else {
        y += h;
      }
    };
    nodes.forEach((c, i) => rec(c, side * (rootHalf + gapX), branchStart + i));
  };
  place(right, 1, 0);
  place(left, -1, right.length);
  return out;
}
