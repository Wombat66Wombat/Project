import { describe, expect, it } from 'vitest';
import { brier, calibration, groupDecisions, parseOutcome, readDecision, verdict, type Decision } from './decisions';
import { decisionTemplate } from './templates';
import type { Note } from './types';

const note = (title: string, body: string): Note => ({ id: title, type: 'note', title, body, createdAt: 0, updatedAt: 0 });
const d = (confidence: number, outcome: number | null, review = '2026-01-01'): Decision => ({
  id: `${confidence}-${outcome}-${Math.random()}`, title: 't', decided: null, prediction: '', confidence, review, outcome, lesson: '',
});

describe('decisions', () => {
  it('reads the decision template', () => {
    const dec = readDecision(note('Take the job', decisionTemplate(new Date('2026-01-15T12:00:00Z'))))!;
    expect(dec).toMatchObject({ decided: '2026-01-15', confidence: 70, review: '2026-04-15', outcome: null });
    expect(readDecision(note('Plain', 'hello'))).toBeNull();
  });
  it('understands outcomes in plain words', () => {
    expect([parseOutcome('right'), parseOutcome('Yes, it did'), parseOutcome('partly'), parseOutcome('wrong'), parseOutcome(''), parseOutcome('falsch')]).toEqual([1, 1, 0.5, 0, null, 0]);
  });
  it('sorts decisions into due, upcoming and resolved', () => {
    const g = groupDecisions([d(70, null, '2026-01-01'), d(70, null, '2027-01-01'), d(80, 1)], '2026-06-01');
    expect([g.due.length, g.upcoming.length, g.resolved.length]).toEqual([1, 1, 1]);
  });
  it('measures calibration and Brier score', () => {
    const list = [d(90, 1), d(90, 1), d(90, 0), d(90, 0), d(60, 1), d(30, 0)];
    const b = calibration(list);
    expect(b.find((x) => x.label === '90–100%')).toMatchObject({ n: 2 * 2, actual: 50 });
    expect(b.find((x) => x.label === '70–79%')).toMatchObject({ n: 1, actual: 100 }); // 30% that X, X didn't happen = 70% right
    expect(brier([d(100, 1), d(0, 0)])).toBe(0);
    expect(brier([d(50, 1), d(50, 0)])).toBe(0.25);
    expect(verdict(list)).toMatch(/overconfident/);
    expect(verdict(list.slice(0, 2))).toMatch(/Review 3 more decisions/);
  });
});
