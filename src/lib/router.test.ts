import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('parses routes', () => {
    expect(parseHash('#/note/abc')).toEqual({ name: 'note', id: 'abc' });
    expect(parseHash('#/new/A%2FB%20c')).toEqual({ name: 'new', title: 'A/B c' });
    expect(parseHash('#/graph')).toEqual({ name: 'graph' });
    expect(parseHash('#/decisions')).toEqual({ name: 'decisions' });
    expect(parseHash('#/nope')).toEqual({ name: 'home' });
    expect(parseHash('')).toEqual({ name: 'home' });
  });
  it('parses live invite links', () => {
    expect(parseHash('#/live/AbCdEfGhIjKlMnOpQrStUv/Trip%20plans')).toEqual({ name: 'live', room: 'AbCdEfGhIjKlMnOpQrStUv', title: 'Trip plans' });
    expect(parseHash('#/live/bad!/x')).toEqual({ name: 'home' });
  });
  it('falls back to home for blank or malformed links', () => {
    expect(parseHash('#/new/%20%20')).toEqual({ name: 'home' });
    expect(parseHash('#/note/%E0%A4%A')).toEqual({ name: 'home' });
  });
});
