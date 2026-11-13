/** Convert article HTML into clean Markdown (headings, paragraphs, lists, quotes, code, links). */
export function htmlToMarkdown(root: Element, baseUrl = ''): string {
  /** An absolute http(s) link, or null when it can't be trusted to point at the right place. */
  const abs = (href: string): string | null => {
    try {
      const u = new URL(href, baseUrl || 'https://unknown.invalid/');
      if (u.hostname === 'unknown.invalid' || !/^https?:$/.test(u.protocol)) return null;
      return u.href;
    } catch {
      return null;
    }
  };
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/\s+/g, ' ');
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    const el = n as Element;
    const inner = () => [...el.childNodes].map(inline).join('');
    switch (el.tagName) {
      case 'STRONG':
      case 'B': {
        const t = inner().trim();
        return t ? `**${t}**` : '';
      }
      case 'EM':
      case 'I': {
        const t = inner().trim();
        return t ? `*${t}*` : '';
      }
      case 'CODE':
        return `\`${el.textContent ?? ''}\``;
      case 'BR':
        return '\n';
      case 'A': {
        const t = inner().trim();
        const href = el.getAttribute('href');
        const link = href && !href.startsWith('#') ? abs(href) : null;
        return link && t ? `[${t}](${link})` : t;
      }
      case 'IMG':
      case 'SCRIPT':
      case 'STYLE':
        return '';
      default:
        return inner();
    }
  };
  const blocks: string[] = [];
  const block = (el: Element, depth = 0): void => {
    const tag = el.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const t = inline(el).trim();
      if (t) blocks.push(`${'#'.repeat(Math.max(2, +tag[1]))} ${t}`);
    } else if (tag === 'P') {
      const t = inline(el).trim();
      if (t) blocks.push(t);
    } else if (tag === 'UL' || tag === 'OL') {
      const items = [...el.children].filter((c) => c.tagName === 'LI');
      const lines = items.map((li, i) => {
        const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const text = [...li.childNodes].filter((c) => !nested.includes(c as Element)).map(inline).join('').trim();
        const marker = tag === 'OL' ? `${i + 1}.` : '-';
        const sub = nested.map((nl) => {
          const before = blocks.length;
          block(nl, depth + 1);
          return blocks.splice(before).join('\n');
        });
        return [`${'  '.repeat(depth)}${marker} ${text}`, ...sub].join('\n');
      });
      if (lines.length) blocks.push(lines.join('\n'));
    } else if (tag === 'BLOCKQUOTE') {
      const t = inline(el).trim();
      if (t) blocks.push(t.split('\n').map((l) => `> ${l}`).join('\n'));
    } else if (tag === 'PRE') {
      blocks.push('```\n' + (el.textContent ?? '').replace(/\n$/, '') + '\n```');
    } else if (['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'BUTTON', 'FIGURE', 'IMG', 'SVG'].includes(tag)) {
      // skip
    } else if (el.children.length === 0) {
      const t = inline(el).trim();
      if (t) blocks.push(t);
    } else {
      for (const c of el.children) block(c, depth);
    }
  };
  for (const c of root.children) block(c);
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
