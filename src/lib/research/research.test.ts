import { describe, expect, it } from 'vitest';
import { parseTranscript, transcriptMarkdown, youtubeId, formatTime } from './transcript';
import { keySentences, sentences } from './keypoints';
import { notePassages, headingText } from './passages';
import { claimFromQuote, citeLabel, pdfSource, videoSource } from './source';
import { pageText } from './pdf';
import { parseArticle } from './article';
import type { Note } from '../types';

const note = (title: string, body: string): Note => ({ id: title, type: 'note', title, body, createdAt: 0, updatedAt: 0 });

describe('transcripts', () => {
  it('reads YouTube copy-paste, skipping duration labels', () => {
    const raw = '0:00\n2 seconds\nhello everyone\n0:04\ntoday we talk\nabout sleep\n1:02:03\nlate part';
    expect(parseTranscript(raw)).toEqual([
      { t: 0, text: 'hello everyone' },
      { t: 4, text: 'today we talk about sleep' },
      { t: 3723, text: 'late part' },
    ]);
  });
  it('reads [mm:ss] lines, SRT and VTT', () => {
    expect(parseTranscript('[00:05] first\n01:10 second')).toEqual([{ t: 5, text: 'first' }, { t: 70, text: 'second' }]);
    const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello <i>there</i>\n\n2\n00:01:00,500 --> 00:01:02,000\nAgain';
    expect(parseTranscript(srt)).toEqual([{ t: 1, text: 'Hello there' }, { t: 60, text: 'Again' }]);
    const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nVTT line';
    expect(parseTranscript(vtt)).toEqual([{ t: 2, text: 'VTT line' }]);
  });
  it('links timestamps to the video', () => {
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=x')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(formatTime(3723)).toBe('1:02:03');
    const md = transcriptMarkdown([{ t: 0, text: 'a' }, { t: 30, text: 'b' }, { t: 75, text: 'c' }], 'https://youtu.be/dQw4w9WgXcQ');
    expect(md).toBe('## [0:00](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=0s)\na b\n\n## [1:15](https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=75s)\nc');
  });
});

describe('sources and passages', () => {
  it('builds a PDF source with page sections and cites pages', () => {
    const { title, body } = pdfSource({ title: 'Paper', author: 'Ann', pages: ['First page text.', '', 'Third.'] }, 'paper.pdf');
    expect(title).toBe('Paper');
    expect(body).toMatch(/^type:: source\nkind:: pdf\nfile:: paper.pdf\nauthor:: Ann\npages:: 3\nimported:: \d{4}-\d\d-\d\d\n\n## Page 1\nFirst page text.\n\n## Page 3\nThird.$/);
    expect(notePassages(note(title, body))).toEqual([
      { text: 'First page text.', section: 'Page 1' },
      { text: 'Third.', section: 'Page 3' },
    ]);
    expect(citeLabel('Page 3')).toBe('p. 3');
  });
  it('builds a video source and plain-text headings', () => {
    const { body } = videoSource('Talk', 'https://youtu.be/dQw4w9WgXcQ', [{ t: 0, text: 'hi' }]);
    expect(body).toContain('url:: https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(headingText('## [0:00](https://x?t=0s)')).toBe('0:00');
  });
  it('makes claims that quote and cite their source', () => {
    const c = claimFromQuote('  Deep sleep   helps memory consolidation in adults and children alike.  ', 'Sleep paper', 'Page 4');
    expect(c.title).toBe('Deep sleep helps memory consolidation in adults and children…');
    expect(c.body).toBe('type:: claim\nsource:: [[Sleep paper]]\npage:: 4\n\n> Deep sleep helps memory consolidation in adults and children alike.\n\nWhy it matters:\n');
    expect(claimFromQuote('Short quote here', 'Talk', '12:30').body).toContain('at:: 12:30');
  });
});

describe('key sentences', () => {
  it('splits sentences and picks central ones in reading order', () => {
    expect(sentences('Too short. This sentence is long enough to count here. And this one too, clearly long enough!')).toHaveLength(2);
    const body = [
      'Sleep strengthens memory by replaying the day during deep sleep stages.',
      'Researchers found deep sleep improves memory retention in students.',
      'The cafeteria serves lunch at noon on most weekdays this term.',
      'Memory consolidation depends on deep sleep and its slow brain waves.',
      'Parking near the lab costs five euros per day for visitors.',
      'Students who slept well remembered more words the next morning.',
    ].join(' ');
    const picked = keySentences(note('Sleep study', body), 3).map((k) => k.text);
    expect(picked).toHaveLength(3);
    expect(picked.some((s) => s.includes('cafeteria') || s.includes('Parking'))).toBe(false);
  });
});

describe('PDF page text', () => {
  it('joins lines into paragraphs and repairs hyphenation', () => {
    const it = (str: string, y: number) => ({ str, transform: [1, 0, 0, 1, 0, y], height: 10 });
    expect(pageText([it('The first line con-', 700), it('tinues here.', 688), it('New paragraph.', 650)])).toBe(
      'The first line continues here.\n\nNew paragraph.',
    );
  });
});

describe('PDF headings', () => {
  it('starts a new paragraph when the font size changes', () => {
    const it2 = (str: string, y: number, h: number) => ({ str, transform: [1, 0, 0, 1, 0, y], height: h });
    expect(pageText([it2('Big Title', 700, 20), it2('Body text starts here.', 680, 10)])).toBe('Big Title\n\nBody text starts here.');
  });
});

describe('articles', () => {
  it('keeps the article and drops navigation', () => {
    const html = `<html><head><title>Why sleep matters | Blog</title><link rel="canonical" href="https://ex.com/sleep"></head>
      <body><nav><a href="/">Home</a> <a href="/about">About</a></nav>
      <article><h1>Why sleep matters</h1>
      <p>Sleep is essential for memory. During deep sleep the brain replays what it learned during the day, strengthening connections.</p>
      <p>Adults need seven to nine hours. Teenagers need even more, according to <a href="/study">this study</a>.</p>
      <ul><li>Keep a schedule</li><li>Avoid caffeine late</li></ul>
      <p>Many people underestimate how much sleep debt affects focus, mood, and long-term health outcomes over years.</p></article>
      <footer>© 2026</footer></body></html>`;
    const a = parseArticle(html);
    expect(a.url).toBe('https://ex.com/sleep');
    expect(a.markdown).toContain('Sleep is essential for memory.');
    expect(a.markdown).toContain('[this study](https://ex.com/study)');
    expect(a.markdown).toContain('- Keep a schedule');
    expect(a.markdown).not.toContain('About');
    expect(a.markdown).not.toContain('© 2026');
  });
  it('keeps link text but drops links it cannot resolve', () => {
    const html = '<html><body><article><h1>T</h1><p>' + 'Some long enough article text here. '.repeat(8) + 'See <a href="/x">this page</a> and <a href="javascript:alert(1)">that</a>.</p></article></body></html>';
    const md = parseArticle(html).markdown;
    expect(md).toContain('See this page and that.');
    expect(md).not.toContain('](');
  });
  it('drops the site name from the title', () => {
    const html = (t: string) => `<html><head><title>${t}</title><meta property="og:site_name" content="Daily Science"></head><body><article><p>${'Long enough article body text. '.repeat(10)}</p></article></body></html>`;
    expect(parseArticle(html('Coffee and focus | Daily Science')).title).toBe('Coffee and focus');
    expect(parseArticle(html('Coffee and focus – Daily Science')).title).toBe('Coffee and focus');
    expect(parseArticle(html('Why A - B matters')).title).toBe('Why A - B matters');
  });
  it('treats pasted plain text as title + paragraphs', () => {
    expect(parseArticle('My title\n\nPara one\nwraps.\n\nPara two.')).toMatchObject({ title: 'My title', markdown: 'Para one wraps.\n\nPara two.' });
  });
});
