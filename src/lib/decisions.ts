import type { Note } from './types';
import { getField, noteKind, numberField } from './fields';

export interface Decision {
  id: string;
  title: string;
  decided: string | null;
  prediction: string;
  /** How sure you were that the prediction would come true, 0–100. */
  confidence: number | null;
  review: string | null;
  /** 1 = came true, 0.5 = partly, 0 = didn't, null = not reviewed yet. */
  outcome: number | null;
  lesson: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** "right", "yes", "true", "✓" → 1 · "partly", "mixed" → 0.5 · "wrong", "no" → 0. */
export function parseOutcome(v: string | undefined): number | null {
  const s = (v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(right|yes|true|correct|came true|happened|✓|✔|1|richtig|ja|oui|vrai)\b/.test(s)) return 1;
  if (/^(partly|partial|partially|mixed|half|somewhat|0\.5|teilweise|en partie)\b/.test(s)) return 0.5;
  if (/^(wrong|no|false|incorrect|didn'?t|did not|✗|✘|0|falsch|nein|non|faux)\b/.test(s)) return 0;
  return null;
}

export function readDecision(n: Note): Decision | null {
  if (noteKind(n.body) !== 'decision') return null;
  const conf = numberField(n.body, 'confidence', true);
  const review = getField(n.body, 'review') ?? '';
  const decided = getField(n.body, 'decided') ?? '';
  return {
    id: n.id,
    title: n.title,
    decided: ISO.test(decided) ? decided : null,
    prediction: getField(n.body, 'prediction') ?? '',
    confidence: conf === null ? null : Math.max(0, Math.min(100, conf)),
    review: ISO.test(review) ? review : null,
    outcome: parseOutcome(getField(n.body, 'outcome')),
    lesson: getField(n.body, 'lesson') ?? '',
  };
}

export const today = (d = new Date()) => d.toISOString().slice(0, 10);

export function groupDecisions(list: Decision[], now = today()) {
  const due = list.filter((d) => d.outcome === null && d.review !== null && d.review <= now).sort((a, b) => a.review!.localeCompare(b.review!));
  const upcoming = list.filter((d) => d.outcome === null && (d.review === null || d.review > now)).sort((a, b) => (a.review ?? '9').localeCompare(b.review ?? '9'));
  const resolved = list.filter((d) => d.outcome !== null).sort((a, b) => (b.review ?? '').localeCompare(a.review ?? ''));
  return { due, upcoming, resolved };
}

export interface Bucket {
  /** e.g. "70–79%" */
  label: string;
  from: number;
  to: number;
  /** Average stated confidence in this bucket (%). */
  stated: number;
  /** How often those predictions came true (%). */
  actual: number;
  n: number;
}

const RANGES: [number, number][] = [
  [50, 59],
  [60, 69],
  [70, 79],
  [80, 89],
  [90, 100],
];

/**
 * Calibration: for each confidence band, how often you were actually right.
 * Predictions under 50% are folded in as the opposite prediction (40% that X = 60% that not-X).
 */
export function calibration(resolved: Decision[]): Bucket[] {
  const rows = resolved
    .filter((d) => d.confidence !== null && d.outcome !== null)
    .map((d) => (d.confidence! < 50 ? { p: 100 - d.confidence!, o: 1 - d.outcome! } : { p: d.confidence!, o: d.outcome! }));
  return RANGES.map(([from, to]) => {
    const inside = rows.filter((r) => r.p >= from && r.p <= to);
    const n = inside.length;
    return {
      label: `${from}–${to}%`,
      from,
      to,
      stated: n ? inside.reduce((s, r) => s + r.p, 0) / n : (from + to) / 2,
      actual: n ? (inside.reduce((s, r) => s + r.o, 0) / n) * 100 : 0,
      n,
    };
  }).filter((b) => b.n > 0);
}

/** Brier score: mean squared gap between confidence and outcome. 0 is perfect; always saying 50% scores 0.25. */
export function brier(resolved: Decision[]): number | null {
  const rows = resolved.filter((d) => d.confidence !== null && d.outcome !== null);
  if (!rows.length) return null;
  return rows.reduce((s, d) => s + (d.confidence! / 100 - d.outcome!) ** 2, 0) / rows.length;
}

/** A plain-language reading of your calibration, once there's enough to say something. */
export function verdict(resolved: Decision[]): string {
  const rows = resolved.filter((d) => d.confidence !== null && d.outcome !== null);
  if (rows.length < 5) return `Review ${5 - rows.length} more decision${5 - rows.length === 1 ? '' : 's'} to see how well calibrated you are.`;
  const stated = rows.reduce((s, d) => s + Math.max(d.confidence!, 100 - d.confidence!), 0) / rows.length;
  const actual = (rows.reduce((s, d) => s + (d.confidence! < 50 ? 1 - d.outcome! : d.outcome!), 0) / rows.length) * 100;
  const gap = Math.round(stated - actual);
  if (gap > 8) return `You tend to be overconfident: on average you were ${Math.round(stated)}% sure but right ${Math.round(actual)}% of the time.`;
  if (gap < -8) return `You tend to be underconfident: on average you were ${Math.round(stated)}% sure but right ${Math.round(actual)}% of the time. Trust yourself a bit more.`;
  return `Well calibrated: on average you were ${Math.round(stated)}% sure and right ${Math.round(actual)}% of the time.`;
}
