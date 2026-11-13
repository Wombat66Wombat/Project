# Atlas design

Atlas combines seven ideas into one app. They share one core: **notes that link to each other**, with plain-text fields that give them types and typed links.
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
- **The user owns the data.** Everything stays in the browser, with JSON export and optional sync to the user's own GitHub repo as Markdown files.
- **No AI service.** Everything "smart" is either classic algorithms (TextRank, TF-IDF, label propagation, diff3) or a small model running in the browser.

## Data model

Everything is a note: `{ id, title, body, createdAt, updatedAt, extra? }`. Structure lives *in the text* as Dataview-style fields, so it syncs, searches and opens in other editors like any other line:

```
type:: decision            → the note's kind (note, source, claim, decision, recipe, pantry, person, topic…)
confidence:: 70            → plain values
supports:: [[Claim A]]     → typed links (supports, contradicts, rebuts, evidence, source, topics, with…)
```

`src/lib/fields.ts` parses them, and `buildIndex` (`src/lib/links.ts`) records each note's kind, its plain `[[links]]` (both directions) and its typed links (both directions). Every view reads from that one index.

| Idea | Built as |
|---|---|
| Research assistant | Importers create `type:: source` notes (one section per PDF page / video minute / article heading); claims are `type:: claim` notes with `source:: [[…]]` and `page::`/`at::`; Ask ranks passages. |
| Collaborative mind map | The Map tab is a view of a note's headings and bullets; live editing binds the note's text to a Yjs document. |
| Wiki from chats/emails | An importer that creates conversation, email, person and topic notes, linked by `with::` and `topics::`; the backlinks make the wiki. |
| Argument mapper | A view over typed links, plus rules for weak points. |
| Recipe graph | A lens: `type:: recipe` notes are parsed for ingredients/steps, matched against the `type:: pantry` note. |
| Decision journal | A lens: `type:: decision` notes with prediction, confidence, review and outcome fields. |
| City view | A view: link communities as districts, notes as buildings. |

## Stages

1. ✅ **Core:** notes, `[[links]]`, backlinks, rename-safe links, full-text search, graph view, JSON backup, GitHub Pages deploy.
2. ✅ **Storage and sync:** IndexedDB storage (stage-1 notes migrate automatically), plus optional sync to a private GitHub repo as Markdown files.
3. ✅ **Smart search:** meaning-based search and "Related" suggestions with an embedding model running in the browser.
4. ✅ **Research:** PDF, article and YouTube importers, key sentences, highlight → claim with citation, Ask with cited passages.
5. ✅ **Mind map:** balanced auto-layout, keyboard editing, written back to Markdown.
6. ✅ **Live collaboration:** Yjs over WebRTC (Trystero, public Nostr relays), presence, cursor-safe merging.
7. ✅ **Argument map:** typed links and weak-point detection.
8. ✅ **Wiki from chats and email:** ChatGPT/Claude exports and mailboxes become linked notes, people, topics and decisions.
9. ✅ **Decision journal:** reviews, calibration chart and Brier score.
10. ✅ **Recipes:** pantry matching, vegetarian swaps and alternatives, recipe import from schema.org data.
11. ✅ **City:** a 3D city of link communities.

## GitHub sync (stage 2)

- **Auth:** a fine-grained personal access token limited to one repo with *Contents: read and write*. It is stored in IndexedDB and sent only to `api.github.com`. An OAuth button would need a server to hold a client secret, which a static site can't have.
- **Format:** one Markdown file per note in `notes/`, with JSON-valued YAML front matter (`id`, `title`, `created`, `updated`). Files written elsewhere, without front matter, are imported using their file name as the title. Other front-matter keys (e.g. Obsidian `tags`, `aliases`) are kept verbatim. File names avoid characters that break Windows or macOS checkouts and never differ only by capital letters.
- **Algorithm:** a three-way sync. For each note it compares the local version, GitHub's version and the *base* (the version both sides last agreed on).
  - Changed on one side: copy it to the other side.
  - Changed on both sides: line-based 3-way merge (diff3). If the same lines changed, keep the local version and save GitHub's as "(GitHub copy)". Nothing is lost.
  - Deleted on one side and edited on the other: keep the edit.
  - Untouched welcome notes are never pushed into a repo that already has notes.
- **Efficiency:** files are compared by git blob SHA, so only changed files are downloaded. All changes go up as **one commit** through the Git Data API. If another device pushed in between (non-fast-forward), sync starts over, up to 3 times.
- **When:** on open, about 20 s after the last edit, every 3 min while the tab is visible, when the device comes back online, and on "Sync now".
- **Edits during a sync** are never overwritten: those notes keep their old base, so the next sync merges them.

## Smart search (stage 3)

- **Models:** two small sentence-embedding models run in the browser with transformers.js (ONNX Runtime, WebAssembly, in a Web Worker so typing never stutters). Both are 8-bit quantised and produce 384-dimensional vectors.
  - **English:** `Xenova/all-MiniLM-L6-v2`, 23 MB.
  - **All languages:** `Xenova/multilingual-e5-small`, 118 MB, 100+ languages and cross-language matches.
  - The model downloads once from Hugging Face into the browser cache. The ONNX Runtime engine (14 MB) is served by Atlas itself from `public/ort` (copied by `scripts/copy-ort.mjs`). A Vite alias swaps in onnxruntime's WASM-only build, keeping GPU code and a second 27 MB engine out of the site.
- **Indexing:** each note is split into ~120-word passages that never cross a heading (so Ask can cite a page). The first passage carries the title for context; later ones don't, so a short off-topic passage can't look relevant just because of the document's title. Each passage is embedded, and vectors are stored in IndexedDB with a hash of the note's text, so only new or changed notes are re-embedded. Indexing runs in the background after edits, and vectors of deleted notes are dropped.
- **Search:** a note's score is its best passage's cosine similarity to the query. Keyword (MiniSearch) and meaning results are merged with reciprocal rank fusion; notes found only by meaning are labelled "similar meaning".
- **Related notes:** note vector = normalised mean of its passages. Notes are compared pairwise, and ones already linked are excluded. "+ link" appends `[[Title]]` on a `Related:` line.
- **Thresholds.** Similarity scores differ a lot between models (e5 squeezes everything into 0.75–0.9), so a match must pass three tests:
  - an absolute minimum score;
  - a *lift*: how far above the query's average similarity to all notes it scores;
  - for English, closeness to the best match.

  These were calibrated on a labelled set of 30 notes and 40 queries in English, German and French. The criteria: no results at all for unrelated queries ("quantum physics", "car insurance"…), at least 75% precision, and as much recall as possible. Results:
  - **English:** 86% precision, 60% recall.
  - **All languages:** 88% precision, 60% recall.
  - **Related suggestions:** calibrated separately for at least 80% precision.
- **Privacy:** notes and queries never leave the device. Turning smart search off deletes the vectors and the cached model.

## Research (stage 4)

- **PDF:** pdf.js (loaded only when importing) extracts positioned text; lines are rebuilt into paragraphs, splitting on gaps, column jumps and font-size changes (headings), and re-joining hyphenated words.
- **Articles:** browsers can't fetch other sites (CORS), so the user saves the page or pastes it. Mozilla Readability (Firefox Reader View) extracts the article; links resolve against its canonical URL or are dropped, never pointing at Atlas itself. Recipe pages with schema.org data become recipe notes instead.
- **Transcripts:** YouTube's copy-paste format, `[mm:ss]` lines, SRT and WebVTT; grouped into one-minute sections whose headings link to that moment in the video.
- **Key sentences:** TextRank over IDF-weighted sentence similarity, per paragraph, returned in reading order.
- **Ask:** ranks individual passages by meaning when smart search is on (same thresholds as search), else by keywords, and shows each with its citation.

## Mind map (stage 5)

The outline (headings and nested list items, ignoring code and fields) becomes a tree. Each node knows its line and the last line of its subtree, so edits are line operations on the Markdown: rename, add child, add sibling, delete subtree. Layout: the root in the middle, top-level branches split left/right by leaf count, each side a tidy tree; SVG with pan/zoom.

## Live collaboration (stage 6)

- A live note is bound to a Yjs `Y.Text`. Local edits are applied to it *immediately* as one minimal diff (so a remote update can never overwrite a keystroke); remote edits update the note.
- **Network:** Trystero finds peers through public Nostr relays; data then flows peer-to-peer over encrypted WebRTC data channels. The room id is 128 random bits in the invite link and is also the password that encrypts the handshake.
- **Presence:** Yjs awareness (name, colour, "editing line 12" / selected mind-map idea).
- **The caret stays put** when someone else edits: the editor maps the selection through the remote change.
- **Persistence:** the shared document is kept in IndexedDB, so rejoining a room merges instead of duplicating text. Rooms that were live reconnect after a reload.
- **Limits:** with no server there's no TURN relay, so a few restrictive networks can't connect directly. Yjs and the networking code load only when a note goes live.

## Argument map (stage 7)

Relations come from fields: `A supports:: [[B]]`, `A contradicts:: [[B]]`, `A rebuts:: [[B]]`, `A evidence:: [[S]]` (and a claim's `source::`). The view builds the tree around a note (reasons, objections, answers, evidence) and reports weak points:
- **Unsupported:** a claim with no reasons or evidence.
- **Single source:** at least two lines of support that all trace back to one source.
- **Unanswered objection:** an objection with no rebuttal.
- **Circular reasoning:** a `supports` cycle, reported once.
- **Disputed evidence:** evidence contradicted by an unanswered objection.

## Wiki from chats and email (stage 8)

- **Parsers:** ChatGPT `conversations.json` (following each chat's current branch), Claude `conversations.json`, ZIPs (fflate), mbox and eml (RFC 2047 headers, quoted-printable, base64, multipart; quoted replies and signatures removed). Emails are grouped into threads by `References`/`In-Reply-To`, falling back to subject.
- **Topics:** TF-IDF over words and two-word phrases. A topic must appear in at least two documents and not in nearly all of them (the limit scales with collection size).
- **Decisions:** sentences matching decision phrases ("we decided", "let's go with", German and French equivalents), excluding questions.
- **Owner:** the mailbox owner is found from `Delivered-To` (or frequency) and can be changed; they get no person page.
- **Re-imports:** skipped by `chatid::` / `thread::` fields. Pasted headings and `key::` lines are neutralised so they can't break a note.

## Decision journal (stage 9)

Outcomes are read from plain words (right / partly / wrong, also German and French). Calibration buckets fold predictions under 50% into their opposite. Brier score = mean (confidence − outcome)². The verdict compares average stated confidence with the hit rate once there are 5 reviews. Due reviews show on the home screen and in the Views menu. The chart follows the data-viz rules: a single validated series colour per theme, a perfect-calibration diagonal, hover tooltips, and a table view.

## Recipes (stage 10)

Ingredient lines are normalised: amounts, units, descriptors, parentheses and plurals are removed ("1 tin (400 g) of chopped tomatoes" → "tomato"). Pantry matching is loose ("cherry tomato" ↔ "tomato") with optional basics. Meat and fish are detected longest-name-first, ignoring "vegetable stock" and the like; each gets a vegetarian swap. Similarity combines ingredient Jaccard with cuisine, technique and tags.

## City (stage 11)

Districts are communities from deterministic label propagation (ties go to the smallest label, so the city is stable between visits). They are placed on a square spiral, largest first, with unlinked notes in the Outskirts. Within a district, the most-linked notes take the central lots. Building height reflects links, footprint reflects note length, and glow reflects recency (30-day fade). Rendering uses three.js with one InstancedMesh for all buildings, LineSegments for roads, HTML district labels and raycast hover/click. A district list provides the same information without WebGL.

## One active tab

Each tab holds all notes in memory and saves them as a whole, so two tabs editing at once would overwrite each other. The active tab holds a Web Lock (`src/lib/tabs.ts`). A newly opened tab asks it over a BroadcastChannel to save and step aside, and waits for the lock before loading. The older tab becomes read-only (`inert`) and shows "Atlas is open in another tab — Use Atlas here". With a single tab there's no delay.

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
| `src/lib/tabs.ts` | Single active tab (Web Locks + BroadcastChannel) |
| `src/lib/semantic/models.ts` | Embedding models and calibrated thresholds |
| `src/lib/semantic/core.ts` | Chunking, similarity, search, related notes, result fusion (pure, tested) |
| `src/lib/semantic/worker.ts` | Web Worker running the model |
| `src/lib/semantic/useSemantic.ts` | Settings, background indexing, vector storage |
| `scripts/copy-ort.mjs` | Copies the ONNX Runtime WebAssembly engine into `public/ort` |
| `src/lib/fields.ts` | `key:: value` fields and typed relations |
| `src/lib/templates.ts` | Decision, claim, recipe and pantry templates |
| `src/lib/research/` | PDF, article, transcript importers; passages; key sentences; source and claim notes |
| `src/lib/mindmap.ts` | Outline tree, Markdown edits, balanced layout |
| `src/lib/live/` | Shared text diffs, the peer-to-peer connection, the live-session hook |
| `src/lib/argument.ts` | Argument tree and weak-point rules |
| `src/lib/wiki/` | Chat and mail parsers, topics and decisions, wiki builder |
| `src/lib/decisions.ts` | Decision fields, grouping, calibration, Brier score |
| `src/lib/recipes.ts` | Ingredient parsing, pantry matching, vegetarian logic, recipe import |
| `src/lib/city.ts` | Communities and city layout |
| `src/lib/useAtlas.ts` | App state and actions |
| `src/components/` | Screens and views (note, graph, mind map, argument, ask, import, decisions, recipes, city…) |

## Testing

- **Unit and integration tests:** `npm test`, run in CI on every push. They cover parsing, sync (two simulated devices through an in-memory GitHub), merging, search thresholds, argument rules, calibration, recipes, the city layout and more.
- **Browser checks:** each stage was also checked in headless Chromium, in light and dark mode and at phone width. Local stand-ins replaced outside services: an in-memory GitHub, a local copy of the models, and a minimal Nostr relay so two browsers could edit together live.
