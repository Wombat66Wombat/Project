import { useEffect, useState } from 'react';

/** Whole-collection screens reached from the Views menu. */
export const VIEWS = ['graph', 'city', 'ask', 'decisions', 'recipes', 'import'] as const;
export type ViewName = (typeof VIEWS)[number];

export type Route =
  | { name: 'home' }
  | { name: ViewName }
  | { name: 'note'; id: string }
  | { name: 'new'; title: string }
  | { name: 'live'; room: string; title: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const [, kind, ...rest] = path.split('/');
  let arg = '';
  try {
    arg = decodeURIComponent(rest.join('/')).trim();
  } catch {
    /* malformed % escape: treat as home */
  }
  if ((VIEWS as readonly string[]).includes(kind)) return { name: kind as ViewName };
  if (kind === 'note' && arg) return { name: 'note', id: arg };
  if (kind === 'new' && arg) return { name: 'new', title: arg };
  if (kind === 'live' && rest[0] && /^[\w-]{16,64}$/.test(rest[0])) {
    let title = '';
    try {
      title = decodeURIComponent(rest.slice(1).join('/'));
    } catch {
      /* keep empty */
    }
    return { name: 'live', room: rest[0], title };
  }
  return { name: 'home' };
}

export function noteHref(id: string): string {
  return `#/note/${encodeURIComponent(id)}`;
}

export function navigate(hash: string, replace = false): void {
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
