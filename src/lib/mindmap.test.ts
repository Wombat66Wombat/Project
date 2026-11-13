import { describe, expect, it } from 'vitest';
import { addChild, addSibling, deleteNode, flatten, label, layout, parseOutline, renameNode } from './mindmap';

const body = `type:: note
Intro paragraph.

# Travel
- Lisbon
  - Alfama
- Tokyo

## Budget
Some text.

# Food
1. Pasta
2. Curry`;

const tree = () => parseOutline('Plans', body);
const names = (b: string) => flatten(parseOutline('Plans', b)).map((n) => `${'  '.repeat(depth(n))}${n.text}`);
function depth(n: { parent: unknown }): number {
  let d = 0;
  for (let p = n.parent as { parent: unknown } | null; p; p = p.parent as { parent: unknown } | null) d++;
  return d;
}

describe('parseOutline', () => {
  it('builds a tree from headings and nested lists', () => {
    expect(names(body)).toEqual(['Plans', '  Travel', '    Lisbon', '      Alfama', '    Tokyo', '    Budget', '  Food', '    Pasta', '    Curry']);
  });
  it('knows where each section ends', () => {
    const t = tree();
    const travel = t.children[0];
    expect([travel.line, travel.end]).toEqual([3, 9]);
    expect(travel.children[0].end).toBe(5); // Lisbon owns Alfama
  });
  it('ignores code, fields and plain paragraphs', () => {
    expect(names('```\n- not a node\n```\nkey:: v\ntext\n- real')).toEqual(['Plans', '  real']);
  });
  it('strips Markdown from labels', () => {
    expect(label('See [[Lisbon|the city]] and **[site](http://x)**')).toBe('See the city and site');
  });
});

describe('edits write back to Markdown', () => {
  it('renames items and headings, keeping markers', () => {
    const t = tree();
    expect(renameNode(body, t, '4', 'Lisbon, Portugal')!.body.split('\n')[4]).toBe('- Lisbon, Portugal');
    expect(renameNode(body, t, '11', 'Cooking')!.body.split('\n')[11]).toBe('# Cooking');
    expect(renameNode(body, t, '12', 'Fresh pasta')!.body.split('\n')[12]).toBe('1. Fresh pasta');
  });
  it('adds children under items, headings and the root', () => {
    const t = tree();
    const a = addChild(body, t, '6', 'Kyoto day trip')!;
    expect(a.body.split('\n')[7]).toBe('  - Kyoto day trip');
    expect(names(a.body)).toContain('      Kyoto day trip');
    const b = addChild(body, t, '3', 'Berlin')!; // heading with items: after the last item, before "## Budget"
    expect(b.body.split('\n').slice(4, 8)).toEqual(['- Lisbon', '  - Alfama', '- Tokyo', '- Berlin']);
    const c = addChild('', parseOutline('Empty', ''), 'root', 'First')!;
    expect(c.body).toBe('- First');
    const d = addChild('Just text.', parseOutline('X', 'Just text.'), 'root', 'Idea')!;
    expect(d.body).toBe('Just text.\n\n- Idea');
  });
  it('adds siblings after the whole subtree', () => {
    const t = tree();
    const e = addSibling(body, t, '4', 'Porto')!; // after Lisbon + Alfama
    expect(e.body.split('\n').slice(4, 8)).toEqual(['- Lisbon', '  - Alfama', '- Porto', '- Tokyo']);
    expect(e.select).toBe('6');
    const f = addSibling(body, t, '13', 'Ramen')!;
    expect(f.body.split('\n')[14]).toBe('1. Ramen');
  });
  it('deletes a node with its children', () => {
    const t = tree();
    const g = deleteNode(body, t, '4')!;
    expect(g.body).not.toContain('Alfama');
    expect(g.body).toContain('- Tokyo');
    expect(g.select).toBe('3'); // parent, since Lisbon was the first child
    const h = deleteNode(body, t, '3')!; // whole Travel section, including Budget
    expect(h.body).not.toMatch(/Travel|Budget|Lisbon/);
    expect(h.body).toContain('# Food');
  });
});

describe('layout', () => {
  it('balances branches left and right without overlaps', () => {
    const placed = layout(tree(), () => 100);
    const root = placed.find((p) => p.node.id === 'root')!;
    expect([root.x, root.y]).toEqual([0, 0]);
    const sides = new Set(placed.filter((p) => p.node.parent?.id === 'root').map((p) => p.side));
    expect(sides).toEqual(new Set([1, -1]));
    // No two nodes on the same side and column share a row.
    const keys = placed.map((p) => `${Math.round(p.x)}:${Math.round(p.y)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
