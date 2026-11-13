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
const FIELD_MARK = '\u2063field:'; // invisible separator + tag: can't occur in normal typing

/** Turn `key:: value` lines (outside code) into a marker the field extension renders. */
function markFields(body: string): string {
  let inCode = false;
  return body
    .split('\n')
    .map((l) => {
      if (/^\s*```/.test(l)) inCode = !inCode;
      if (inCode) return l;
      return l.replace(/^(\s*)([A-Za-z][\w-]*)::[ \t]*/, (_, sp: string, key: string) => `${sp}${FIELD_MARK}${key}\u2063 `);
    })
    .join('\n');
}

export function renderMarkdown(body: string, byTitle: Map<string, Note>): string {
  const md = new Marked({ gfm: true, breaks: true });
  md.use({
    extensions: [
      {
        name: 'field',
        level: 'inline',
        start: (src: string) => src.indexOf(FIELD_MARK),
        tokenizer(src: string) {
          const m = new RegExp(`^${FIELD_MARK}([A-Za-z][\\w-]*)\u2063 ?`).exec(src);
          return m ? { type: 'field', raw: m[0], key: m[1] } : undefined;
        },
        renderer(token) {
          return `<span class="field-key">${escapeHtml((token as unknown as { key: string }).key)}</span>`;
        },
      },
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
  const html = md.parse(markFields(body), { async: false }) as string;
  return DOMPurify.sanitize(html);
}
