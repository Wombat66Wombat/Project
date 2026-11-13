/** A spoken line and when it starts, in seconds. */
export interface Segment {
  t: number;
  text: string;
}

const TS = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$/;

function seconds(ts: string): number | null {
  const m = TS.exec(ts.trim());
  if (!m) return null;
  return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
}

export function formatTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/**
 * Parse a transcript in any common form:
 * - YouTube's "Show transcript" copy (timestamp line, then text lines)
 * - "[0:12] text" / "0:12 text" lines
 * - SRT and WebVTT subtitle files
 */
export function parseTranscript(raw: string): Segment[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const out: Segment[] = [];
  const push = (t: number, text: string) => {
    const clean = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const last = out[out.length - 1];
    if (last && last.t === t) last.text += ` ${clean}`;
    else out.push({ t, text: clean });
  };
  let current: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line === 'WEBVTT' || /^(NOTE|STYLE|Kind:|Language:)/.test(line)) continue;
    // SRT/VTT cue timing: "00:00:01,000 --> 00:00:04,000"
    const cue = /^([\d:.,]+)\s*-->\s*[\d:.,]+/.exec(line);
    if (cue) {
      current = seconds(cue[1]);
      continue;
    }
    if (/^\d+$/.test(line) && (lines[i + 1] ?? '').includes('-->')) continue; // SRT cue number
    // "[0:12] text" or "0:12 text"
    const inline = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2})\]?\s+(.+)$/.exec(line);
    if (inline) {
      push(seconds(inline[1])!, inline[2]);
      current = null;
      continue;
    }
    const t = seconds(line);
    if (t !== null) {
      current = t;
      continue;
    }
    // YouTube adds screen-reader durations like "2 seconds" or "1 minute, 5 seconds".
    if (/^\d+ (second|minute|hour)s?(, \d+ (second|minute|hour)s?)*$/.test(line)) continue;
    if (current !== null) push(current, line);
  }
  return out;
}

/** The video id from any YouTube URL form, or null. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

/**
 * Markdown for a video source: paragraphs of about `every` seconds, each headed by its
 * timestamp, linked to that moment in the video when the URL is known.
 */
export function transcriptMarkdown(segments: Segment[], url = '', every = 60): string {
  const id = youtubeId(url);
  const parts: string[] = [];
  let start = -Infinity;
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const label = formatTime(start);
    const heading = id ? `## [${label}](https://www.youtube.com/watch?v=${id}&t=${Math.floor(start)}s)` : `## ${label}`;
    parts.push(`${heading}\n${para.join(' ')}`);
    para = [];
  };
  for (const s of segments) {
    if (s.t - start >= every) {
      flush();
      start = s.t;
    }
    para.push(s.text);
  }
  flush();
  return parts.join('\n\n');
}
