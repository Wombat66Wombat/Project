import { describe, expect, it } from 'vitest';
import { keyAction } from './shortcuts';

const k = (key: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe('shortcuts', () => {
  it('maps single keys and g-sequences', () => {
    expect(keyAction(k('n'), false)).toEqual({ type: 'new' });
    expect(keyAction(k('?'), false)).toEqual({ type: 'help' });
    expect(keyAction(k('g'), false)).toEqual({ type: 'pending-g' });
    expect(keyAction(k('d'), true)).toEqual({ type: 'go', hash: '#/decisions' });
    expect(keyAction(k('G'), true)).toEqual({ type: 'go', hash: '#/graph' });
    expect(keyAction(k('x'), true)).toBeNull();
  });
  it('leaves browser shortcuts alone', () => {
    expect(keyAction(k('n', { ctrlKey: true }), false)).toBeNull();
    expect(keyAction(k('g', { metaKey: true }), false)).toBeNull();
  });
});
