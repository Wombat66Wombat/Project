/** Keyboard shortcuts. Single keys only fire when you're not typing in a field. */
export interface Shortcut {
  keys: string;
  what: string;
}

export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  {
    group: 'Anywhere',
    items: [
      { keys: '⌘K  or  /', what: 'Search' },
      { keys: 'N', what: 'New note' },
      { keys: '?', what: 'Show these shortcuts' },
    ],
  },
  {
    group: 'Go to (press G, then…)',
    items: [
      { keys: 'G H', what: 'Home' },
      { keys: 'G G', what: 'Graph' },
      { keys: 'G C', what: 'City' },
      { keys: 'G A', what: 'Ask' },
      { keys: 'G D', what: 'Decisions' },
      { keys: 'G R', what: 'Recipes' },
      { keys: 'G I', what: 'Import' },
      { keys: 'G S', what: 'Settings' },
    ],
  },
  {
    group: 'In a note',
    items: [
      { keys: 'E', what: 'Switch between reading and editing' },
      { keys: 'M', what: 'Mind map' },
      { keys: 'Esc', what: 'Stop editing' },
      { keys: '[[', what: 'Link another note (while editing)' },
    ],
  },
  {
    group: 'In the mind map',
    items: [
      { keys: 'Tab', what: 'Add a child idea' },
      { keys: 'Enter', what: 'Add an idea next to this one' },
      { keys: 'F2', what: 'Rename' },
      { keys: 'Delete', what: 'Remove' },
      { keys: '← ↑ → ↓', what: 'Move between ideas' },
    ],
  },
];

export const GO_TO: Record<string, string> = {
  h: '#/',
  g: '#/graph',
  c: '#/city',
  a: '#/ask',
  d: '#/decisions',
  r: '#/recipes',
  i: '#/import',
  s: '#/settings',
};

/** True when the key press belongs to a text field (so shortcuts must stay out of the way). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable || !!target.closest('dialog[open]');
}

export type Action = { type: 'go'; hash: string } | { type: 'new' } | { type: 'help' } | { type: 'pending-g' } | null;

/** Turn a key press into an action. `afterG` is true right after "g" was pressed. */
export function keyAction(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>, afterG: boolean): Action {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (afterG) return GO_TO[k] ? { type: 'go', hash: GO_TO[k] } : null;
  if (k === 'g') return { type: 'pending-g' };
  if (k === 'n') return { type: 'new' };
  if (e.key === '?') return { type: 'help' };
  return null;
}
