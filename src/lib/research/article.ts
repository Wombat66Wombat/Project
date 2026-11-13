import { Readability } from '@mozilla/readability';
import { htmlToMarkdown } from './html';

export interface Article {
  title: string;
  markdown: string;
  url: string;
  author: string;
  site: string;
}

/** "Coffee and focus | Daily Science" → "Coffee and focus" when the suffix is the site's name. */
function stripSite(title: string, site: string): string {
  if (!site) return title;
  const m = new RegExp(`^(.+?)\\s*[|\\-–—·:]\\s*${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').exec(title);
  return m ? m[1].trim() : title;
}

const looksLikeHtml = (s: string) => /<(html|body|article|p|div|h[1-6])[\s>]/i.test(s);

/**
 * Turn a saved web page (or pasted text) into a clean article: the main content only,
 * without menus, ads or comments, using Mozilla's Readability (Firefox Reader View).
 */
export function parseArticle(input: string, fallbackTitle = 'Article'): Article {
  if (!looksLikeHtml(input)) {
    const lines = input.replace(/\r\n?/g, '\n').trim().split('\n');
    const title = (lines[0] ?? '').trim().slice(0, 120) || fallbackTitle;
    const body = lines.slice(1).join('\n').trim();
    const paras = body.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    return { title, markdown: paras.join('\n\n'), url: '', author: '', site: '' };
  }
  const doc = new DOMParser().parseFromString(input, 'text/html');
  const url =
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
    doc.querySelector('meta[property="og:url"]')?.getAttribute('content') ||
    '';
  // Readability turns relative links into absolute ones using the document's base URL.
  // Point it at the article's real address; without one, links would resolve to Atlas itself.
  const base = doc.createElement('base');
  base.href = url || 'https://unknown.invalid/';
  doc.head.prepend(base);
  const meta = (sel: string) => doc.querySelector(sel)?.getAttribute('content')?.trim() ?? '';
  const parsed = new Readability(doc.cloneNode(true) as Document).parse();
  const container = document.createElement('div');
  if (parsed?.content) {
    // Re-parse through DOMParser (inert document) rather than innerHTML on a live element.
    const contentDoc = new DOMParser().parseFromString(parsed.content, 'text/html');
    container.append(...contentDoc.body.childNodes);
  } else {
    container.append(...doc.body.cloneNode(true).childNodes);
  }
  const site = (parsed?.siteName || meta('meta[property="og:site_name"]')).trim();
  return {
    title: stripSite((parsed?.title || meta('meta[property="og:title"]') || doc.title || fallbackTitle).trim(), site),
    markdown: htmlToMarkdown(container, url),
    url,
    author: (parsed?.byline || meta('meta[name="author"]')).trim(),
    site,
  };
}
