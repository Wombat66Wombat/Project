# Atlas design

Atlas combines seven ideas into one app. They share one core: a **graph of typed nodes and links**.
Every feature is either an **importer** (adds nodes), a **view** (shows nodes) or a **lens** (a domain-specific node type plus queries).

```
          IMPORTERS                     CORE                      VIEWS
PDFs / articles / YouTube ─┐                                 ┌─ Q&A with citations
Chat & email exports ──────┼─► extraction ─► Knowledge ─────┼─ Wiki pages
Recipes ───────────────────┤                 graph + search  ├─ Mind map (multiplayer)
Decisions / notes ─────────┘                                 ├─ Argument map
                                                             ├─ Decision dashboard
                                                             └─ City view
```

## Constraints

- **Free to run.** Hosted on GitHub Pages: static files only, no server, no paid APIs.
- **The user owns the data.** Everything stays in the browser, with plain JSON export. Planned: sync to a GitHub repo as Markdown files.

## Data model

```ts
Node     { id, type, title, body, createdAt, updatedAt, props? }
         // type: note (now) | source | passage | claim | person | project | topic
         //       | decision | recipe | ingredient
Link     { from, to, type, citation? }
         // stage 1: implicit, from [[wiki links]] in note bodies
         // later:  supports | contradicts | mentions | about | derived_from | uses_ingredient …
Citation { sourceId, passageId, quote, timestamp? }
```

Stage 1 derives links from note text (`src/lib/links.ts`). Typed links come later, stored separately, so the same graph can hold both.

## How each idea maps on

| Idea | Role | Notes for the free / static setup |
|---|---|---|
| Research assistant | Importer + Q&A view | pdf.js, Readability and transcripts run in the browser. Claims are highlighted by hand at first; an optional local model (WebLLM / Ollama) can be added later. |
| Collaborative mind map | View | React Flow + ELK for layout. Live editing with Yjs over WebRTC, peer to peer with no server. |
| Wiki from chats/emails | Importer + wiki view | Parse ChatGPT/Claude JSON and `.mbox` exports in the browser. People and projects become nodes; each node's page lists everything linked to it. |
| Argument mapper | View + rules | Claim/evidence/rebuttal link types. Weak points: claims without evidence, claims with a single source, contradictions, circular support. |
| Recipe graph | Lens | Recipe, ingredient and technique nodes. "What can I make?" is a graph query; "like this but vegetarian" uses tags + similarity. |
| Decision journal | Lens + dashboard | Decision nodes with prediction, confidence and review date. Calibration chart and Brier score. |
| City view | View | Three.js. Topics are districts, notes are buildings (height = links), links are roads, recency = lights. |

## Stages

1. ✅ **Core:** notes, `[[links]]`, backlinks, rename-safe links, full-text search, graph view, JSON backup, GitHub Pages deploy.
2. ✅ **Storage and sync:** IndexedDB storage (stage-1 notes migrate automatically), plus optional sync to a private GitHub repo as Markdown files.
3. Semantic search with a small embedding model running in the browser (transformers.js).
4. Research importer: PDFs, articles and YouTube transcripts, with highlight → claim and citations.
5. Mind map view with auto-layout.
6. Real-time collaboration (Yjs + WebRTC).
7. Argument map with weak-point detection.
8. Chat/email importer and automatic wiki pages.
9. Decision journal.
10. Recipe lens.
11. City view.

## GitHub sync (stage 2)

- **Auth:** a fine-grained personal access token limited to one repo with *Contents: read and write*. It is stored in IndexedDB and sent only to `api.github.com`. An OAuth button would need a server to hold a client secret, which a static site can't have.
- **Format:** one Markdown file per note in `notes/`, with JSON-valued YAML front matter (`id`, `title`, `created`, `updated`). Files written elsewhere, without front matter, are imported using their file name as the title.
- **Algorithm:** a three-way sync. For each note it compares the local version, GitHub's version and the *base* (the version both sides last agreed on).
  - Changed on one side: copy it to the other side.
  - Changed on both sides: line-based 3-way merge (diff3). If the same lines changed, keep the local version and save GitHub's as "(GitHub copy)". Nothing is lost.
  - Deleted on one side and edited on the other: keep the edit.
  - Untouched welcome notes are never pushed into a repo that already has notes.
- **Efficiency:** files are compared by git blob SHA, so only changed files are downloaded. All changes go up as **one commit** through the Git Data API. If another device pushed in between (non-fast-forward), sync starts over, up to 3 times.
- **When:** on open, about 20 s after the last edit, every 3 min while the tab is visible, when the device comes back online, and on "Sync now".
- **Edits during a sync** are never overwritten: those notes keep their old base, so the next sync merges them.

## Code map

| Path | What it does |
|---|---|
| `src/lib/types.ts` | Data model |
| `src/lib/links.ts` | Parsing `[[links]]`, building the graph index, rewriting links on rename |
| `src/lib/search.ts` | Full-text search (MiniSearch) and snippets |
| `src/lib/markdown.ts` | Markdown rendering with wiki links, sanitized with DOMPurify |
| `src/lib/db.ts` | IndexedDB key-value store (falls back to localStorage) |
| `src/lib/store.ts` | Loading and saving notes and deletions, migration, import and export |
| `src/lib/noteFile.ts` | Note ⇄ Markdown file, file names, git blob SHA |
| `src/lib/syncPlan.ts` | The 3-way sync decisions (pure, unit-tested) |
| `src/lib/github.ts` | GitHub REST client with plain-language errors |
| `src/lib/sync.ts` | One sync run: download, plan, commit, retry |
| `src/lib/useSync.ts` | When to sync, status and settings |
| `src/lib/fakeGitHub.ts` | In-memory GitHub used by the tests |
| `src/lib/useAtlas.ts` | App state and actions |
| `src/components/` | Sidebar, note view, link-suggesting editor, graph view |
