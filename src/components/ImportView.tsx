import { useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import { noteHref } from '../lib/router';
import { parseArticle } from '../lib/research/article';
import { parseTranscript } from '../lib/research/transcript';
import { articleSource, pdfSource, videoSource } from '../lib/research/source';
import { ChatImport } from './ChatImport';

interface Props {
  atlas: Atlas;
  uniqueTitle: (base: string) => string;
}

type Tab = 'pdf' | 'article' | 'video' | 'chats';

interface Done {
  id: string;
  title: string;
  detail: string;
}

/** Bring outside knowledge into Atlas as source notes, all processed on this device. */
export function ImportView({ atlas, uniqueTitle }: Props) {
  const [tab, setTab] = useState<Tab>('pdf');
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  const add = (title: string, body: string, detail: string) => {
    const n = atlas.add(uniqueTitle(title), body);
    setDone((d) => [{ id: n.id, title: n.title, detail }, ...d]);
    return n;
  };

  async function importPdfs(files: FileList | File[]) {
    setError('');
    const { readPdf } = await import('../lib/research/pdf'); // pdf.js loads only when needed
    for (const f of Array.from(files)) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
        setError(`“${f.name}” isn't a PDF.`);
        continue;
      }
      try {
        setProgress(`Reading “${f.name}”…`);
        const pdf = await readPdf(await f.arrayBuffer(), f.name, (p, total) => setProgress(`Reading “${f.name}”: page ${p} of ${total}`));
        const s = pdfSource(pdf, f.name);
        const chars = pdf.pages.reduce((n, p) => n + p.length, 0);
        add(s.title, s.body, `${pdf.pages.length} pages${chars < 50 ? ' · no text found (scanned?)' : ''}`);
      } catch (e) {
        setError(`Couldn't read “${f.name}”: ${(e as Error).message}`);
      }
    }
    setProgress('');
  }

  return (
    <section className="screen">
      <h1>Import</h1>
      <p className="muted">
        Turn PDFs, articles, videos and chat history into notes you can search, quote and link. Everything is processed on
        this device.
      </p>

      <div className="tabs" role="tablist">
        {(
          [
            ['pdf', 'PDF'],
            ['article', 'Web article'],
            ['video', 'YouTube video'],
            ['chats', 'Chats & email'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      <div className="card import-card">
        {tab === 'pdf' && (
          <div
            className="drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void importPdfs(e.dataTransfer.files);
            }}
          >
            <p>
              <strong>Drop PDF files here</strong> or{' '}
              <label className="linklike file-label">
                choose files
                <input type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => e.target.files && void importPdfs(e.target.files)} />
              </label>
            </p>
            <p className="muted small">Each page becomes a section, so quotes cite the page. Scanned PDFs (pictures of text) have no text to read.</p>
          </div>
        )}
        {tab === 'article' && <ArticleForm onImport={(t, b, d) => add(t, b, d)} onError={setError} />}
        {tab === 'video' && <VideoForm onImport={(t, b, d) => add(t, b, d)} onError={setError} />}
        {tab === 'chats' && <ChatImport atlas={atlas} uniqueTitle={uniqueTitle} onDone={(items) => setDone((d) => [...items, ...d])} onError={setError} />}
        {progress && (
          <p className="small" role="status">
            {progress}
          </p>
        )}
        {error && (
          <p className="error small" role="alert">
            {error}
          </p>
        )}
      </div>

      {done.length > 0 && (
        <div className="imported">
          <h2>Imported</h2>
          <ul className="cards">
            {done.map((d) => (
              <li key={d.id} className="card row">
                <a href={noteHref(d.id)}>{d.title}</a>
                <span className="muted small">{d.detail}</span>
              </li>
            ))}
          </ul>
          <p className="muted small">
            Open a source to see its key sentences, and select any passage to save it as a claim. Or{' '}
            <a href="#/ask">ask a question</a> across everything you imported.
          </p>
        </div>
      )}
    </section>
  );
}

function ArticleForm({ onImport, onError }: { onImport: (title: string, body: string, detail: string) => void; onError: (e: string) => void }) {
  const [text, setText] = useState('');
  function go(input: string, name = '') {
    onError('');
    if (!input.trim()) return;
    try {
      const a = parseArticle(input, name.replace(/\.(html?|txt|md)$/i, '') || 'Article');
      if (!a.markdown.trim()) return onError('No article text found in that page.');
      const s = articleSource(a);
      onImport(s.title, s.body, [a.site, a.author, `${a.markdown.split(/\s+/).length} words`].filter(Boolean).join(' · '));
      setText('');
    } catch (e) {
      onError(`Couldn't read that article: ${(e as Error).message}`);
    }
  }
  return (
    <div>
      <p className="muted small">
        For privacy reasons, browsers don’t let one website download another, so Atlas can’t fetch a link. Instead,{' '}
        <strong>save the page</strong> (Ctrl+S or ⌘S, “Webpage, HTML only”) and choose the file, or <strong>copy the article and paste it</strong> below.
      </p>
      <label className="btn file-btn">
        Choose saved page…
        <input
          type="file"
          accept=".html,.htm,.txt,.md,text/html,text/plain"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) go(await f.text(), f.name);
            e.target.value = '';
          }}
        />
      </label>
      <textarea
        className="paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Or paste here: the first line becomes the title.\n\nPasting from a browser keeps headings and links.'}
        aria-label="Article text"
        onPaste={(e) => {
          const html = e.clipboardData.getData('text/html');
          if (html) {
            e.preventDefault();
            go(html);
          }
        }}
      />
      <button className="btn primary" disabled={!text.trim()} onClick={() => go(text)}>
        Import article
      </button>
    </div>
  );
}

function VideoForm({ onImport, onError }: { onImport: (title: string, body: string, detail: string) => void; onError: (e: string) => void }) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  function go(raw: string, fallbackTitle = 'Video') {
    onError('');
    const segs = parseTranscript(raw);
    if (segs.length === 0) return onError('No timestamps found. Paste the transcript including its times (e.g. “0:12”).');
    const s = videoSource(title.trim() || fallbackTitle, url.trim(), segs);
    onImport(s.title, s.body, `${segs.length} lines · ${s.body.match(/^length:: (.+)$/m)?.[1] ?? ''}`);
    setText('');
    setTitle('');
    setUrl('');
  }
  return (
    <div>
      <ol className="muted small steps-inline">
        <li>On YouTube, open the video, click <strong>⋯ More</strong> under it, then <strong>Show transcript</strong>.</li>
        <li>Select the whole transcript, copy it, and paste it below. Subtitle files (.srt, .vtt) work too.</li>
      </ol>
      <div className="row-fields">
        <label className="field">
          <span>Video title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Why we sleep, talk" />
        </label>
        <label className="field">
          <span>Video link (optional, makes timestamps clickable)</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
        </label>
      </div>
      <textarea className="paste" value={text} onChange={(e) => setText(e.target.value)} placeholder={'0:00\nHello everyone…\n0:04\nToday we…'} aria-label="Transcript" />
      <div className="row-actions">
        <button className="btn primary" disabled={!text.trim()} onClick={() => go(text)}>
          Import transcript
        </button>
        <label className="btn file-btn">
          Choose .srt / .vtt…
          <input
            type="file"
            accept=".srt,.vtt,.txt"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) go(await f.text(), f.name.replace(/\.(srt|vtt|txt)$/i, ''));
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
