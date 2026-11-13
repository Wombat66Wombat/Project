# Atlas

A personal knowledge graph: notes that link to each other, plus research, mind maps, live collaboration, arguments, a wiki from your chats and email, a decision journal, recipes, and a 3D city of your notes.

It runs entirely in your browser and is hosted for free on GitHub Pages: no server, no account, no API key, no subscription. Your notes stay on your device unless you choose to sync them to your own private GitHub repository.

## What it does

### Notes and links
- **Markdown notes** with `[[wiki links]]`. Suggestions appear as you type `[[`, and `[[Title|other text]]` shows different link text.
- **Backlinks and renames:** every note lists the notes that link to it, and renaming a note updates every link to it.
- **Search:** typo-tolerant full-text search (`Ctrl/⌘ K` or `/`).
- **Graph:** **Views → Graph** shows every note and link as an interactive map.
- **Fields:** lines like `type:: decision` or `supports:: [[Claim]]` give notes structure. This is the same syntax as Obsidian's Dataview plugin, so it's plain text that stays portable.
- **Templates:** **New ▾** offers Note, Decision, Claim, Recipe and Pantry.

### Sync with GitHub (free)
Notes live in your browser (IndexedDB). To back them up and use them on several devices, sync them to a **private** repository:
1. Create a private repository, e.g. `atlas-notes`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to **only that repository** and the permission **Contents: Read and write**.
3. In Atlas, click **Sync**, enter the repository and token, and click **Connect**. Do the same on your other devices.

How it behaves:
- **One file per note:** each note is a Markdown file, so GitHub keeps every version and other editors like Obsidian can open them.
- **Edits on two devices are merged.** If both changed the same lines, both versions are kept.
- **The token stays in your browser** and is only sent to GitHub.

### Smart search (free, on your device)
Turn it on from **⋯ → Smart search**:
- **Search by meaning:** "can't sleep" also finds your note about insomnia.
- **Related notes:** each note suggests notes with a similar meaning, with one-click **+ link**.

Pick **English** (23 MB download) or **All languages** (118 MB, 100+ languages, matches across languages). The model downloads once from Hugging Face, then works offline. Notes and searches never leave the device.

### Research (Views → Import, Views → Ask)
- **Import:**
  - **PDFs:** text is extracted page by page.
  - **Web articles:** save the page or paste it; Atlas keeps just the article.
  - **YouTube transcripts:** paste them or use an .srt/.vtt file; timestamps link to the moment in the video.
- **Key sentences:** each source shows its most central sentences.
- **Claims:** select any passage to **Save as claim**. You get a note that quotes it and cites the page or timestamp.
- **Ask:** questions are answered with the passages that answer them, each with its citation.

### Mind map (Map tab on any note)
- **Map from the note:** its headings and bullet lists become a balanced mind map.
- **Edit in the map:** Tab adds a child, Enter a sibling, F2 renames, Delete removes, and arrows move around.
- **Stays in sync:** every change is written back into the note's Markdown.

### Live collaboration (Live button on any note)
- **Invite by link:** start a live session and share the link.
- **Edit together:** text and mind map edits merge in real time, even when you type at the same moment.
- **See each other:** you see who's there and where they are.
- **Direct and encrypted:** browsers connect peer-to-peer over encrypted WebRTC. Free public relays (Nostr) only help them find each other.
- **No account needed:** anyone with the link can edit, so share it only with people you trust.

### Argument map (Argue tab)
- **Write the argument in fields:** `supports:: [[X]]`, `contradicts:: [[X]]`, `rebuts:: [[Objection]]`, `evidence:: [[Source]]`.
- **See it as a map:** the note's reasons, objections, answers and evidence. You can add any of them in place.
- **Weak points are flagged automatically:**
  - unsupported claims;
  - support that all traces back to a single source;
  - unanswered objections;
  - circular reasoning;
  - disputed evidence.

### Wiki from chats and email (Views → Import → Chats & email)
- **What you can import:** ChatGPT and Claude data exports (ZIP or `conversations.json`) and mailboxes (`.mbox` from Google Takeout, Thunderbird or Apple Mail, or `.eml` files).
- **What you get:**
  - a note per conversation and email thread;
  - a page per person you email with;
  - topic pages for subjects that come up repeatedly;
  - a checklist of decisions found in the text.
- **You see a preview first,** and re-importing skips anything already imported.

### Decision journal (New ▾ → Decision, Views → Decisions)
- **Record it:** what you decided, what you expect, how sure you are, and when to review.
- **Reminders:** Atlas shows when a review is due, and you record what happened with one tap.
- **Calibration:** a chart compares how sure you were with how often you were right, alongside your Brier score and a plain-language verdict ("you tend to be overconfident…").

### Recipes (New ▾ → Recipe / Pantry, Views → Recipes)
- **What can I make?** Recipes are ranked against your Pantry note, with what's missing and one click to a shopping list.
- **Vegetarian:** vegetarian recipes are detected, and meat or fish gets swaps plus "vegetarian recipes like this".
- **Similar recipes:** matched by ingredients, cuisine and technique.
- **Import from the web:** saved recipe pages become recipe notes automatically.

### City (Views → City)
- **Districts** are groups of linked notes.
- **Buildings** are notes: taller with more links, lit up when edited recently.
- **Roads** are the links between notes.
- **Explore:** orbit and zoom, and click a building to open its note. A district list sits alongside for phones and screen readers.

### Everything else
- **Light and dark mode,** and a phone layout.
- **Backup:** export and restore all notes as JSON from **⋯**.
- **One editing tab:** opening Atlas in a second tab pauses the first, so tabs can never overwrite each other.

## Run it locally

```bash
npm install      # .npmrc sets legacy-peer-deps (works around an npm bug with vitest's optional peers)
npm run dev      # http://localhost:5173
npm test         # unit and integration tests
npm run build    # production build in dist/
```

## Deploy to GitHub Pages (free)

1. Make the repository public. On a free GitHub plan, Pages only works for public repos.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes the app to `https://<your-username>.github.io/<repo-name>/`.

See [DESIGN.md](DESIGN.md) for how it all works.
