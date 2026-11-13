import { setField } from '../fields';
import { formatTime, transcriptMarkdown, youtubeId, type Segment } from './transcript';
import type { PdfDoc } from './pdf';
import type { Article } from './article';

const today = () => new Date().toISOString().slice(0, 10);

function header(fields: Record<string, string>): string {
  return Object.entries(fields)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}:: ${v}`)
    .join('\n');
}

/** A source note for a PDF: one section per page, so quotes can cite the page. */
export function pdfSource(pdf: PdfDoc, fileName: string): { title: string; body: string } {
  const pages = pdf.pages
    .map((text, i) => (text.trim() ? `## Page ${i + 1}\n${text.trim()}` : ''))
    .filter(Boolean)
    .join('\n\n');
  const body = `${header({ type: 'source', kind: 'pdf', file: fileName, author: pdf.author, pages: String(pdf.pages.length), imported: today() })}\n\n${pages || '*No text found. This PDF may be scanned images; text inside images can’t be read.*'}`;
  return { title: pdf.title, body };
}

export function articleSource(a: Article): { title: string; body: string } {
  const body = `${header({ type: 'source', kind: 'article', url: a.url, author: a.author, site: a.site, imported: today() })}\n\n${a.markdown}`;
  return { title: a.title, body };
}

export function videoSource(title: string, url: string, segments: Segment[]): { title: string; body: string } {
  const id = youtubeId(url);
  const length = segments.length ? formatTime(segments[segments.length - 1].t) : '';
  const body = `${header({ type: 'source', kind: 'video', url: id ? `https://www.youtube.com/watch?v=${id}` : url, length, imported: today() })}\n\n${transcriptMarkdown(segments, url)}`;
  return { title, body };
}

/** Where a quote sits: "p. 4" for PDF pages, "12:30" for videos, the heading otherwise. */
export function citeLabel(section: string): string {
  const page = /^Page (\d+)$/.exec(section);
  if (page) return `p. ${page[1]}`;
  return section;
}

/** A claim note quoting a source, with a citation back to it. */
export function claimFromQuote(quote: string, sourceTitle: string, section: string): { title: string; body: string } {
  const clean = quote.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  const title = words.slice(0, 9).join(' ').replace(/[.,;:!?]+$/, '') + (words.length > 9 ? '…' : '');
  let body = `type:: claim\nsource:: [[${sourceTitle}]]\n\n> ${clean}\n\nWhy it matters:\n`;
  const page = /^Page (\d+)$/.exec(section);
  if (page) body = setField(body, 'page', page[1]);
  else if (/^(\d+:)?\d+:\d\d$/.test(section)) body = setField(body, 'at', section);
  else if (section) body = setField(body, 'section', section);
  return { title, body };
}
