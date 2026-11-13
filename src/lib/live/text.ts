import type * as Y from 'yjs';

/**
 * Apply the change from `from` to `to` onto a shared Y.Text as one small edit (common prefix
 * and suffix kept), so concurrent edits by other people elsewhere in the text survive.
 */
export function applyTextDiff(ytext: Y.Text, from: string, to: string): void {
  if (from === to) return;
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from.charCodeAt(start) === to.charCodeAt(start)) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from.charCodeAt(endFrom - 1) === to.charCodeAt(endTo - 1)) {
    endFrom--;
    endTo--;
  }
  if (endFrom > start) ytext.delete(start, endFrom - start);
  if (endTo > start) ytext.insert(start, to.slice(start, endTo));
}

/** A random, unguessable room id (128 bits, URL-safe). */
export function newRoomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const COLORS = ['#e5484d', '#0e8f7e', '#c2410c', '#be185d', '#2563eb', '#7c3aed', '#16a34a', '#ca8a04'];
export const colorFor = (seed: string) => COLORS[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
