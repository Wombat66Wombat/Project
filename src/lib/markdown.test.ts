import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';
import { buildIndex } from './links';
import type { Note } from './types';

const notes: Note[] = [{ id: 'x1', type: 'note', title: 'Known', body: '', createdAt: 0, updatedAt: 0 }];
const { byTitle } = buildIndex(notes);

describe('renderMarkdown', () => {
  it('turns wiki links into note and create links', () => {
    const html = renderMarkdown('[[Known|k]] and [[Unknown]]', byTitle);
    expect(html).toContain('href="#/note/x1"');
    expect(html).toContain('>k</a>');
    expect(html).toContain('href="#/new/Unknown"');
    expect(html).toContain('class="wikilink missing"');
  });
  it('sanitises script and handlers', () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"><script>alert(2)</script>', byTitle);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });
  it('escapes link labels', () => {
    const div = document.createElement('div');
    div.innerHTML = renderMarkdown('[[<b>hi</b>]]', byTitle);
    expect(div.querySelector('b')).toBeNull();
    expect(div.textContent?.trim()).toBe('<b>hi</b>');
  });
  it('opens external links in a new tab safely', () => {
    const html = renderMarkdown('[site](https://example.com)', byTitle);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it('keeps links in code literal', () => {
    expect(renderMarkdown('`[[Known]]`', byTitle)).toContain('<code>[[Known]]</code>');
  });
});
