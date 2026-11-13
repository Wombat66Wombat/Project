import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfDoc {
  title: string;
  author: string;
  pages: string[];
}

interface Item {
  str: string;
  transform: number[];
  height: number;
  hasEOL?: boolean;
}

/** Rebuild readable paragraphs from a page's positioned text pieces. */
export function pageText(items: Item[]): string {
  const lines: { y: number; h: number; text: string }[] = [];
  for (const it of items) {
    if (!it.str) continue;
    const y = it.transform[5];
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - y) < Math.max(2, it.height * 0.5)) {
      last.text += (last.text.endsWith(' ') || it.str.startsWith(' ') ? '' : ' ') + it.str;
    } else {
      lines.push({ y, h: it.height || 10, text: it.str });
    }
  }
  const paras: string[] = [];
  let cur = '';
  lines.forEach((l, i) => {
    const text = l.text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const prev = lines[i - 1];
    const gap = prev ? prev.y - l.y : 0;
    // New paragraph on a big gap, a jump up (new column), or a change of font size (a heading).
    const sizeChange = prev ? Math.abs(prev.h - l.h) > Math.min(prev.h, l.h) * 0.2 : false;
    const newPara = !cur || gap > l.h * 1.8 || gap < -l.h || sizeChange;
    if (newPara) {
      if (cur) paras.push(cur);
      cur = text;
    } else if (/[A-Za-zÀ-ÿ]-$/.test(cur) && /^[a-zà-ÿ]/.test(text)) {
      cur = cur.slice(0, -1) + text; // re-join hyphenated words
    } else {
      cur += ` ${text}`;
    }
  });
  if (cur) paras.push(cur);
  return paras.join('\n\n');
}

/** Extract the text of every page, entirely in the browser. */
export async function readPdf(data: ArrayBuffer, fileName: string, onPage?: (n: number, total: number) => void): Promise<PdfDoc> {
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(pageText(content.items as Item[]));
    onPage?.(p, doc.numPages);
  }
  await task.destroy();
  const title = info.Title?.trim() && !/^(untitled|microsoft word)/i.test(info.Title) ? info.Title.trim() : fileName.replace(/\.pdf$/i, '');
  return { title, author: info.Author?.trim() ?? '', pages };
}
