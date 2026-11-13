import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'graph' }
  | { name: 'note'; id: string }
  | { name: 'new'; title: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const [, kind, ...rest] = path.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (kind === 'graph') return { name: 'graph' };
  if (kind === 'note' && arg) return { name: 'note', id: arg };
  if (kind === 'new' && arg) return { name: 'new', title: arg };
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
