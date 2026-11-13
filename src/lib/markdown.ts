import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { normalizeTitle } from './links';
import type { Note } from './types';

// Open external links in a new tab without giving the page access to Atlas.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? '';
    if (/^https?:/i.test(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  }
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Render a note body to sanitised HTML. [[Wiki links]] become
 * `#/note/<id>` links, or `#/new/<title>` for notes that don't exist yet.
 * Uses a marked extension so links inside code blocks stay literal.
 */
export function renderMarkdown(body: string, byTitle: Map<string, Note>): string {
  const md = new Marked({ gfm: true, breaks: true });
  md.use({
    extensions: [
      {
        name: 'wikilink',
        level: 'inline',
        start: (src: string) => src.indexOf('[['),
        tokenizer(src: string) {
          const m = /^\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/.exec(src);
          if (!m) return undefined;
          return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] ?? m[1]).trim() };
        },
        renderer(token) {
          const { target, label } = token as unknown as { target: string; label: string };
          const note = byTitle.get(normalizeTitle(target));
          if (note) {
            return `<a class="wikilink" href="#/note/${encodeURIComponent(note.id)}">${escapeHtml(label)}</a>`;
          }
          return `<a class="wikilink missing" title="Create “${escapeHtml(target)}”" href="#/new/${encodeURIComponent(target)}">${escapeHtml(label)}</a>`;
        },
      },
    ],
  });
  const html = md.parse(body, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
