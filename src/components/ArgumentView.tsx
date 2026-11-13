import { useMemo, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Note } from '../lib/types';
import { buildArgument, conclusionsOf, targetsOf, weakPoints, type ArgNode, type WeakPoint } from '../lib/argument';
import { normalizeTitle, uniqueTitle } from '../lib/links';
import { parseFields, setField } from '../lib/fields';
import { plainText } from '../lib/research/passages';
import { noteHref } from '../lib/router';

interface Props {
  atlas: Atlas;
  note: Note;
  /** Edit the focus note's body (goes through live collaboration when it's live). */
  setBody: (body: string) => void;
}

type AddKind = 'supports' | 'contradicts' | 'rebuts' | 'evidence';

const ROLE_LABEL: Record<ArgNode['role'], string> = {
  focus: 'Claim',
  reason: 'Reason for',
  objection: 'Objection',
  rebuttal: 'Answer',
  evidence: 'Evidence',
};

/** Add `[[title]]` to a field like `supports::`, keeping links already there. */
export function addLinkToField(body: string, key: string, title: string): string {
  const f = parseFields(body).find((x) => x.key === key);
  if (f?.links.some((l) => normalizeTitle(l) === normalizeTitle(title))) return body;
  const value = f && f.value.trim() ? `${f.value}, [[${title}]]` : `[[${title}]]`;
  return setField(body, key, value);
}

/** A short excerpt: the quote if it is one, else the first paragraph. */
function excerpt(n: Note): string {
  const quote = /^>\s?(.+)$/m.exec(n.body);
  const text = quote ? quote[1] : plainText(n.body.split('\n').filter((l) => !/^\s*[A-Za-z][\w-]*::/.test(l)).join('\n')).split('\n\n')[0] ?? '';
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

/** The argument around a note: what backs it, what speaks against it, and where it is weak. */
export function ArgumentView({ atlas, note, setBody }: Props) {
  const { index } = atlas;
  const tree = useMemo(() => buildArgument(index, note.id), [index, note.id]);
  const weak = useMemo(() => weakPoints(index, tree), [index, tree]);
  const weakIds = new Set(weak.map((w) => w.noteId));
  const [adding, setAdding] = useState<{ target: string; kind: AddKind } | null>(null);
  const title = (id: string) => index.byId.get(id)?.title ?? '(deleted)';

  const editBody = (id: string, body: string) => (id === note.id ? setBody(body) : atlas.updateBody(id, body));

  /** Link a note (existing or new) to `target` with relation `kind`. */
  function add(target: string, kind: AddKind, text: string) {
    const t = text.trim();
    if (!t) return;
    const targetNote = index.byId.get(target);
    if (!targetNote) return;
    const existing = index.byTitle.get(normalizeTitle(t));
    if (kind === 'evidence') {
      // The target lists its evidence: target  evidence:: [[S]]
      let s = existing;
      if (!s) s = atlas.add(uniqueTitle(index.byTitle, t), 'type:: source\n\n');
      editBody(target, addLinkToField(targetNote.body, 'evidence', s.title));
    } else if (existing) {
      // The other note points at the target: X  supports:: [[target]]
      editBody(existing.id, addLinkToField(existing.body, kind, targetNote.title));
    } else {
      atlas.add(uniqueTitle(index.byTitle, t), `type:: claim\n${kind}:: [[${targetNote.title}]]\n\n`);
    }
    setAdding(null);
  }

  const conclusions = conclusionsOf(index, note.id);
  const against = targetsOf(index, note.id);
  const isEmpty = tree.children.length === 0 && conclusions.length === 0 && against.length === 0;

  const renderNode = (n: ArgNode, depth: number) => {
    const item = index.byId.get(n.id);
    if (!item) return null;
    const evidence = n.children.filter((c) => c.role === 'evidence');
    const rest = n.children.filter((c) => c.role !== 'evidence');
    const actions: [AddKind, string][] =
      n.role === 'evidence'
        ? []
        : n.role === 'objection'
          ? [['rebuts', '+ Answer'], ['evidence', '+ Evidence']]
          : [['supports', '+ Reason'], ['contradicts', '+ Objection'], ['evidence', '+ Evidence']];
    return (
      <li key={`${n.id}-${n.role}-${depth}`} className={`arg ${n.role} ${weakIds.has(n.id) ? 'weak' : ''}`}>
        <div className="arg-card">
          <div className="arg-head">
            <span className="arg-role">{ROLE_LABEL[n.role]}</span>
            {weakIds.has(n.id) && (
              <span className="arg-warn" title="Has a weak point (see the list above)">
                ⚠
              </span>
            )}
            <a href={noteHref(n.id)} className="arg-title">
              {item.title}
            </a>
            {n.repeat && <span className="muted small">(already shown above)</span>}
          </div>
          {depth > 0 && !n.repeat && excerpt(item) && <p className="arg-text">{excerpt(item)}</p>}
          {evidence.length > 0 && (
            <div className="arg-evidence">
              <span className="muted small">Evidence:</span>
              {evidence.map((e) => (
                <a key={e.id} href={noteHref(e.id)} className={`chip-mini ${weakIds.has(e.id) ? 'weak' : ''}`}>
                  {title(e.id)}
                  {weakIds.has(e.id) ? ' ⚠' : ''}
                </a>
              ))}
            </div>
          )}
          {!n.repeat && actions.length > 0 && (
            <div className="arg-actions">
              {actions.map(([k, lbl]) => (
                <button key={k} className="linklike small" onClick={() => setAdding({ target: n.id, kind: k })}>
                  {lbl}
                </button>
              ))}
            </div>
          )}
          {adding?.target === n.id && <AddForm atlas={atlas} kind={adding.kind} onAdd={(t) => add(n.id, adding.kind, t)} onCancel={() => setAdding(null)} />}
        </div>
        {rest.length > 0 && <ul className="arg-children">{rest.map((c) => renderNode(c, depth + 1))}</ul>}
      </li>
    );
  };

  const reasons = tree.children.filter((c) => c.role === 'reason');
  const objections = tree.children.filter((c) => c.role === 'objection' || c.role === 'rebuttal');
  const evidence = tree.children.filter((c) => c.role === 'evidence');

  return (
    <div className="argument">
      {weak.length > 0 && (
        <section className="card weak-list" aria-label="Weak points">
          <h2>⚠ {weak.length} weak point{weak.length === 1 ? '' : 's'}</h2>
          <ul>
            {weak.map((w, i) => (
              <li key={i}>
                <WeakText w={w} title={title} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(conclusions.length > 0 || against.length > 0) && (
        <div className="arg-up">
          {conclusions.length > 0 && (
            <span>
              This supports:{' '}
              {conclusions.map((c) => (
                <a key={c} className="chip-mini" href={noteHref(c)}>
                  {title(c)}
                </a>
              ))}
            </span>
          )}
          {against.length > 0 && (
            <span>
              This argues against:{' '}
              {against.map((c) => (
                <a key={c} className="chip-mini" href={noteHref(c)}>
                  {title(c)}
                </a>
              ))}
            </span>
          )}
        </div>
      )}

      <div className={`arg-focus ${weakIds.has(note.id) ? 'weak' : ''}`}>
        <span className="arg-role">Claim</span>
        <strong>{note.title}</strong>
        {excerpt(note) && <p className="arg-text">{excerpt(note)}</p>}
        {evidence.length > 0 && (
          <div className="arg-evidence">
            <span className="muted small">Evidence:</span>
            {evidence.map((e) => (
              <a key={e.id} href={noteHref(e.id)} className={`chip-mini ${weakIds.has(e.id) ? 'weak' : ''}`}>
                {title(e.id)}
                {weakIds.has(e.id) ? ' ⚠' : ''}
              </a>
            ))}
          </div>
        )}
        <div className="arg-actions">
          <button className="btn small-btn" onClick={() => setAdding({ target: note.id, kind: 'supports' })}>
            + Reason for
          </button>
          <button className="btn small-btn" onClick={() => setAdding({ target: note.id, kind: 'contradicts' })}>
            + Objection
          </button>
          <button className="btn small-btn" onClick={() => setAdding({ target: note.id, kind: 'evidence' })}>
            + Evidence
          </button>
        </div>
        {adding?.target === note.id && <AddForm atlas={atlas} kind={adding.kind} onAdd={(t) => add(note.id, adding.kind, t)} onCancel={() => setAdding(null)} />}
      </div>

      {isEmpty ? (
        <div className="empty muted small">
          <p>No argument yet. Add a reason, an objection or evidence above, or write fields in any note:</p>
          <pre className="arg-help">{`supports:: [[${note.title}]]      (in a note that backs this up)
contradicts:: [[${note.title}]]   (in a note that argues against it)
evidence:: [[Some source]]        (in this note: what backs it)`}</pre>
        </div>
      ) : (
        <div className="arg-cols">
          <section>
            <h2 className="arg-col-head pro">Reasons for ({reasons.length})</h2>
            {reasons.length ? <ul className="arg-tree">{reasons.map((r) => renderNode(r, 1))}</ul> : <p className="muted small">None yet.</p>}
          </section>
          <section>
            <h2 className="arg-col-head con">Objections ({objections.filter((o) => o.role === 'objection').length})</h2>
            {objections.length ? <ul className="arg-tree">{objections.map((r) => renderNode(r, 1))}</ul> : <p className="muted small">None yet. A strong claim survives its best objection: try adding one.</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function WeakText({ w, title }: { w: WeakPoint; title: (id: string) => string }) {
  const L = ({ id }: { id: string }) => <a href={noteHref(id)}>“{title(id)}”</a>;
  switch (w.kind) {
    case 'unsupported':
      return (
        <>
          <L id={w.noteId} /> has no reasons or evidence yet.
        </>
      );
    case 'single-source':
      return (
        <>
          <L id={w.noteId} /> looks well supported, but everything behind it comes from one source: <L id={w.related[0]} />.
        </>
      );
    case 'unanswered':
      return (
        <>
          The objection <L id={w.related[0]} /> to <L id={w.noteId} /> hasn’t been answered.
        </>
      );
    case 'circular':
      return (
        <>
          Circular reasoning:{' '}
          {w.related.map((id, i) => (
            <span key={i}>
              {i > 0 && ' → '}
              <L id={id} />
            </span>
          ))}
          .
        </>
      );
    case 'disputed-evidence':
      return (
        <>
          The evidence <L id={w.noteId} /> is disputed by <L id={w.related[0]} />, and that hasn’t been answered.
        </>
      );
  }
}

function AddForm({ atlas, kind, onAdd, onCancel }: { atlas: Atlas; kind: AddKind; onAdd: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const listId = `arg-titles-${kind}`;
  const what = { supports: 'reason', contradicts: 'objection', rebuts: 'answer', evidence: 'piece of evidence' }[kind];
  return (
    <form
      className="arg-add"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(text);
      }}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        list={listId}
        placeholder={`New ${what} in one sentence, or an existing note’s title`}
        aria-label={`Add a ${what}`}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      />
      <datalist id={listId}>
        {atlas.notes.slice(0, 500).map((n) => (
          <option key={n.id} value={n.title} />
        ))}
      </datalist>
      <button className="btn primary small-btn" disabled={!text.trim()}>
        Add
      </button>
      <button type="button" className="btn ghost small-btn" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
