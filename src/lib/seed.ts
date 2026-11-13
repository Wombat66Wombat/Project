import type { Note } from './types';

/** Notes shown on first launch. They double as a tour of the features. */
export function seedNotes(): Note[] {
  const now = Date.now();
  const mk = (id: string, title: string, body: string, ago: number): Note => ({
    id,
    type: 'note',
    title,
    body,
    createdAt: now - ago,
    updatedAt: now - ago,
  });
  return [
    mk(
      'welcome',
      'Welcome to Atlas',
      `Atlas is your personal knowledge graph: notes that link to each other.

- Read [[How links work]] to connect ideas.
- Open the **Graph** view (top right) to see how everything connects.
- Everything is saved in this browser. Click **Sync** (top right) to back it up to GitHub and use it on all your devices.

Curious where this is going? See the [[Roadmap]].`,
      3000,
    ),
    mk(
      'how-links-work',
      'How links work',
      `Type two square brackets and a note's title, like \`[[Roadmap]]\`, to link to it.

- Typing \`[[\` shows suggestions as you type.
- Links to notes that don't exist yet appear *dashed*, like [[An idea for later]]. Click one to create it.
- Use \`[[Title|other words]]\` to show different text, e.g. [[Welcome to Atlas|back to the start]].
- Every note lists its **backlinks**: the notes that link to it.
- Renaming a note updates every link that points to it.`,
      2000,
    ),
    mk(
      'roadmap',
      'Roadmap',
      `Atlas grows in stages, all on top of the same graph:

1. **Notes, links, search, graph** ✓
2. **Sync with GitHub** ✓ ← you are here
3. Smart search that understands meaning
4. Research importer: PDFs, articles and YouTube transcripts with citations
5. Collaborative mind map with auto-layout
6. Real-time multiplayer
7. Argument map with weak-point detection
8. Personal wiki from chat and email exports
9. Decision journal with calibration tracking
10. Recipe knowledge graph
11. City view: your knowledge as a city

Related: [[Welcome to Atlas]], [[How links work]].`,
      1000,
    ),
  ];
}
