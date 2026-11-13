import { describe, expect, it } from 'vitest';
import { mapPosition } from './LinkEditor';

describe('mapPosition', () => {
  it('keeps the caret in place when someone edits elsewhere', () => {
    expect(mapPosition('hello world', 'hello world!!', 3)).toBe(3); // edit after the caret
    expect(mapPosition('hello world', 'XYhello world', 3)).toBe(5); // edit before the caret
    expect(mapPosition('abc def', 'abc ghi', 5)).toBe(7); // caret inside a replaced word
    expect(mapPosition('same', 'same', 2)).toBe(2);
  });
});
