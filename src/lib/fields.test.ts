import { describe, expect, it } from 'vitest';
import { getField, noteKind, numberField, parseFields, setField } from './fields';

describe('fields', () => {
  const body = 'type:: decision\nConfidence:: 70%\nsupports:: [[Claim A]], [[Claim B|b]]\n\nText\n```\nfake:: no\n```';
  it('parses fields with links, skipping code', () => {
    expect(parseFields(body)).toEqual([
      { key: 'type', value: 'decision', links: [], line: 0 },
      { key: 'confidence', value: '70%', links: [], line: 1 },
      { key: 'supports', value: '[[Claim A]], [[Claim B|b]]', links: ['Claim A', 'Claim B'], line: 2 },
    ]);
  });
  it('reads kinds and numbers', () => {
    expect(noteKind(body)).toBe('decision');
    expect(noteKind('plain text')).toBe('note');
    expect(numberField(body, 'confidence')).toBe(70);
    expect(numberField('p:: 0.7', 'p', true)).toBe(70);
    expect(numberField('p:: 7,5', 'p')).toBe(7.5);
    expect(getField(body, 'missing')).toBeUndefined();
  });
  it('updates or inserts fields', () => {
    expect(setField(body, 'confidence', '80').split('\n')[1]).toBe('confidence:: 80');
    expect(setField('type:: x\nhello', 'outcome', 'right')).toBe('type:: x\noutcome:: right\nhello');
    expect(setField('hello', 'type', 'recipe')).toBe('type:: recipe\nhello');
  });
});
