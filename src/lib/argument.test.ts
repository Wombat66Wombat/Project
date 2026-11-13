import { describe, expect, it } from 'vitest';
import { buildArgument, sourcesBehind, supportCycle, weakPoints } from './argument';
import { buildIndex } from './links';
import type { Note } from './types';

const n = (title: string, body = ''): Note => ({ id: title, type: 'note', title, body, createdAt: 0, updatedAt: 0 });

const notes = [
  n('Sleep matters', 'type:: claim'),
  n('Memory', 'type:: claim\nsupports:: [[Sleep matters]]\nevidence:: [[Study A]]'),
  n('Mood', 'type:: claim\nsupports:: [[Sleep matters]]\nevidence:: [[Study A]]'),
  n('Some thrive on 5h', 'type:: claim\ncontradicts:: [[Sleep matters]]'),
  n('Rare gene', 'type:: claim\nrebuts:: [[Some thrive on 5h]]\nevidence:: [[Study B]]'),
  n('Naps are enough', 'type:: claim\ncontradicts:: [[Sleep matters]]'),
  n('Study A', 'type:: source'),
  n('Study B', 'type:: source'),
  n('Doubt about A', 'contradicts:: [[Study A]]'),
];
const ix = buildIndex(notes);

describe('buildArgument', () => {
  it('collects reasons, objections, rebuttals and evidence', () => {
    const tree = buildArgument(ix, 'Sleep matters');
    const show = (a: ReturnType<typeof buildArgument>): unknown => [a.role, a.id, a.children.map(show)];
    expect(show(tree)).toEqual([
      'focus', 'Sleep matters', [
        ['reason', 'Memory', [['evidence', 'Study A', []]]],
        ['reason', 'Mood', [['evidence', 'Study A', []]]],
        ['objection', 'Some thrive on 5h', [['rebuttal', 'Rare gene', [['evidence', 'Study B', []]]]]],
        ['objection', 'Naps are enough', []],
      ],
    ]);
  });
  it('stops at notes already on the branch', () => {
    const loop = buildIndex([n('A', 'supports:: [[B]]'), n('B', 'supports:: [[A]]')]);
    const t = buildArgument(loop, 'A');
    expect(t.children[0]).toMatchObject({ id: 'B', children: [{ id: 'A', repeat: true }] });
  });
});

describe('weak points', () => {
  it('finds single sources, unanswered objections, unsupported claims and disputed evidence', () => {
    const w = weakPoints(ix, buildArgument(ix, 'Sleep matters'));
    const has = (kind: string, noteId: string, related?: string[]) =>
      w.some((x) => x.kind === kind && x.noteId === noteId && (!related || JSON.stringify(x.related) === JSON.stringify(related)));
    expect(has('single-source', 'Sleep matters', ['Study A'])).toBe(true); // both reasons rest on Study A
    expect(has('unanswered', 'Sleep matters', ['Naps are enough'])).toBe(true);
    expect(has('unanswered', 'Sleep matters', ['Some thrive on 5h'])).toBe(false); // it has a rebuttal
    expect(has('unsupported', 'Naps are enough')).toBe(true);
    expect(has('disputed-evidence', 'Study A', ['Doubt about A'])).toBe(true);
    expect(sourcesBehind(ix, 'Sleep matters')).toEqual(new Set(['Study A']));
  });
  it('reports circular support once', () => {
    const loop = buildIndex([n('A', 'supports:: [[B]]'), n('B', 'supports:: [[C]]'), n('C', 'supports:: [[A]]')]);
    expect(supportCycle(loop, 'A')).toEqual(['A', 'B', 'C', 'A']);
    const w = weakPoints(loop, buildArgument(loop, 'A')).filter((x) => x.kind === 'circular');
    expect(w).toHaveLength(1);
  });
  it('is quiet about a well-supported claim', () => {
    const good = buildIndex([n('Claim'), n('R1', 'supports:: [[Claim]]\nevidence:: [[S1]]'), n('R2', 'supports:: [[Claim]]\nevidence:: [[S2]]'), n('S1'), n('S2')]);
    expect(weakPoints(good, buildArgument(good, 'Claim'))).toEqual([]);
  });
});
