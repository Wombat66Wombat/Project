import { useMemo, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import { brier, calibration, groupDecisions, readDecision, today, verdict, type Bucket, type Decision } from '../lib/decisions';
import { setField } from '../lib/fields';
import { noteHref } from '../lib/router';

interface Props {
  atlas: Atlas;
  onNew: () => void;
}

const OUTCOME_LABEL = (o: number | null) => (o === 1 ? 'Came true' : o === 0.5 ? 'Partly' : o === 0 ? "Didn't happen" : 'Open');

/** Decision journal: what's due for review, what's coming, and how well calibrated you are. */
export function DecisionsView({ atlas, onNew }: Props) {
  const decisions = useMemo(() => atlas.notes.map(readDecision).filter((d): d is Decision => !!d), [atlas.notes]);
  const { due, upcoming, resolved } = useMemo(() => groupDecisions(decisions), [decisions]);
  const buckets = useMemo(() => calibration(resolved), [resolved]);
  const score = brier(resolved);

  function record(d: Decision, outcome: 'right' | 'partly' | 'wrong') {
    const n = atlas.index.byId.get(d.id);
    if (n) atlas.updateBody(d.id, setField(n.body, 'outcome', outcome));
  }

  if (decisions.length === 0) {
    return (
      <section className="screen">
        <h1>Decisions</h1>
        <div className="empty card">
          <p>
            <strong>Keep a decision journal.</strong> Write down what you decided, what you expect to happen and how sure you
            are. When the review date comes, record what actually happened.
          </p>
          <p className="muted small">
            Over time you’ll see whether your confidence matches reality, the most useful habit for making better decisions.
          </p>
          <button className="btn primary" onClick={onNew}>
            + First decision
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Decisions</h1>
        <button className="btn primary" onClick={onNew}>
          + New decision
        </button>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile-num">{decisions.length}</span>
          <span className="tile-label">decisions</span>
        </div>
        <div className="tile">
          <span className="tile-num">{due.length}</span>
          <span className="tile-label">due for review</span>
        </div>
        <div className="tile">
          <span className="tile-num">{resolved.length}</span>
          <span className="tile-label">reviewed</span>
        </div>
        <div className="tile" title="Average squared gap between your confidence and what happened. 0 is perfect; always saying 50% scores 0.25.">
          <span className="tile-num">{score === null ? '–' : score.toFixed(2)}</span>
          <span className="tile-label">Brier score (lower is better)</span>
        </div>
      </div>

      {due.length > 0 && (
        <section className="dec-section">
          <h2>Due for review</h2>
          <ul className="cards">
            {due.map((d) => (
              <li key={d.id} className="card dec-card due">
                <a href={noteHref(d.id)} className="dec-title">
                  {d.title}
                </a>
                <p className="dec-pred">
                  You predicted: <strong>{d.prediction || '(no prediction written)'}</strong>
                  {d.confidence !== null && <span className="muted"> · {Math.round(d.confidence)}% sure</span>}
                  {d.decided && <span className="muted"> · decided {d.decided}</span>}
                </p>
                <div className="row-actions">
                  <span className="small">What happened?</span>
                  <button className="btn small-btn" onClick={() => record(d, 'right')}>
                    ✓ It came true
                  </button>
                  <button className="btn small-btn" onClick={() => record(d, 'partly')}>
                    ◐ Partly
                  </button>
                  <button className="btn small-btn" onClick={() => record(d, 'wrong')}>
                    ✗ It didn’t
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dec-section">
        <h2>How well calibrated am I?</h2>
        <p className="muted">{verdict(resolved)}</p>
        {buckets.length > 0 && <CalibrationChart buckets={buckets} />}
      </section>

      {upcoming.length > 0 && (
        <section className="dec-section">
          <h2>Coming up</h2>
          <ul className="dec-list">
            {upcoming.map((d) => (
              <li key={d.id}>
                <a href={noteHref(d.id)}>{d.title}</a>
                <span className="muted small">
                  {d.confidence !== null ? ` · ${Math.round(d.confidence)}% sure` : ''} · review {d.review ?? 'not set'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {resolved.length > 0 && (
        <section className="dec-section">
          <h2>Reviewed</h2>
          <ul className="dec-list">
            {resolved.map((d) => (
              <li key={d.id}>
                <span className={`outcome o${String(d.outcome).replace('.', '')}`}>{OUTCOME_LABEL(d.outcome)}</span>
                <a href={noteHref(d.id)}>{d.title}</a>
                <span className="muted small">{d.confidence !== null ? ` · ${Math.round(d.confidence)}% sure` : ''}</span>
                {d.lesson && <span className="muted small"> · lesson: {d.lesson}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <LessonHint due={due.length} />
    </section>
  );
}

function LessonHint({ due }: { due: number }) {
  if (due > 0) return null;
  return (
    <p className="muted small">
      Tip: add a <code>lesson::</code> line to a reviewed decision to remember what you learned. Review dates come from each
      decision’s <code>review::</code> field (today is {today()}).
    </p>
  );
}

/** Stated confidence (x) against how often it came true (y); the dashed diagonal is perfect calibration. */
function CalibrationChart({ buckets }: { buckets: Bucket[] }) {
  const [hover, setHover] = useState<Bucket | null>(null);
  const [table, setTable] = useState(false);
  const W = 420;
  const H = 300;
  const m = { l: 62, r: 16, t: 14, b: 40 };
  const x = (v: number) => m.l + ((v - 50) / 50) * (W - m.l - m.r);
  const y = (v: number) => H - m.b - (v / 100) * (H - m.t - m.b);
  const r = (n: number) => Math.min(14, 6 + Math.sqrt(n) * 2.5);
  return (
    <div className="calib">
      <div className="calib-head">
        <span className="small muted">Each dot is a confidence band; bigger dots hold more decisions.</span>
        <button className="linklike small" onClick={() => setTable((t) => !t)}>
          {table ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {table ? (
        <table className="calib-table">
          <thead>
            <tr>
              <th>When I said</th>
              <th>Average</th>
              <th>I was right</th>
              <th>Decisions</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.label}>
                <td>{b.label}</td>
                <td>{Math.round(b.stated)}%</td>
                <td>{Math.round(b.actual)}%</td>
                <td>{b.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="calib-plot">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calibration chart: stated confidence against how often predictions came true">
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={`y${v}`}>
                <line className="grid" x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} />
                <text className="tick" x={m.l - 8} y={y(v)} textAnchor="end" dominantBaseline="central">
                  {v}%
                </text>
              </g>
            ))}
            {[50, 60, 70, 80, 90, 100].map((v) => (
              <text key={`x${v}`} className="tick" x={x(v)} y={H - m.b + 16} textAnchor="middle">
                {v}%
              </text>
            ))}
            <text className="axis-label" x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">
              How sure I said I was
            </text>
            <text className="axis-label" transform={`translate(14,${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
              How often I was right
            </text>
            <line className="ideal" x1={x(50)} y1={y(50)} x2={x(100)} y2={y(100)} />
            <text className="ideal-label" x={x(97)} y={y(97) - 8} textAnchor="end">
              perfectly calibrated
            </text>
            {buckets.map((b) => (
              <g key={b.label}>
                <circle className="dot" cx={x(b.stated)} cy={y(b.actual)} r={r(b.n)} />
                {/* Larger invisible hit target than the mark */}
                <circle
                  cx={x(b.stated)}
                  cy={y(b.actual)}
                  r={Math.max(18, r(b.n) + 6)}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${b.label}: right ${Math.round(b.actual)}% of the time, ${b.n} decisions`}
                  onMouseEnter={() => setHover(b)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(b)}
                  onBlur={() => setHover(null)}
                />
              </g>
            ))}
          </svg>
          {hover && (
            <div className="chart-tip" style={{ left: `${(x(hover.stated) / W) * 100}%`, top: `${(y(hover.actual) / H) * 100}%` }}>
              <strong>{hover.label} sure</strong>
              <br />
              Right {Math.round(hover.actual)}% of the time
              <br />
              <span className="muted">
                {hover.n} decision{hover.n === 1 ? '' : 's'} · average {Math.round(hover.stated)}%
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
