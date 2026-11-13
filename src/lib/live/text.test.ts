import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTextDiff, newRoomId } from './text';

const sync = (a: Y.Doc, b: Y.Doc) => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
};

describe('live text', () => {
  it('turns a text change into a minimal edit', () => {
    const d = new Y.Doc();
    const t = d.getText('body');
    t.insert(0, 'hello world');
    let ops = 0;
    d.on('update', () => ops++);
    applyTextDiff(t, 'hello world', 'hello brave world');
    expect(t.toString()).toBe('hello brave world');
    expect(ops).toBe(1);
    applyTextDiff(t, 'hello brave world', 'hello world!');
    expect(t.toString()).toBe('hello world!');
  });
  it('merges two people typing in different places at once', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('body').insert(0, 'Line one\nLine two\n');
    sync(a, b);
    applyTextDiff(a.getText('body'), 'Line one\nLine two\n', 'Line one, edited by A\nLine two\n');
    applyTextDiff(b.getText('body'), 'Line one\nLine two\n', 'Line one\nLine two, edited by B\n');
    sync(a, b);
    expect(a.getText('body').toString()).toBe('Line one, edited by A\nLine two, edited by B\n');
    expect(b.getText('body').toString()).toBe(a.getText('body').toString());
  });
  it('makes unguessable room ids', () => {
    expect(newRoomId()).toMatch(/^[\w-]{22}$/);
    expect(newRoomId()).not.toBe(newRoomId());
  });
});
