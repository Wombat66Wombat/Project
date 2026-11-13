# Atlas

A personal knowledge graph: notes that link to each other, with search and a graph view.
It runs entirely in your browser and is hosted for free on GitHub Pages: no server, no account, no API key.

## Features (stage 1)

- **Notes in Markdown.** Headings, lists, code and links all work.
- **`[[Wiki links]]`** between notes, with suggestions after you type `[[`.
  - `[[Title|other text]]` shows different link text.
  - Links to notes that don't exist yet are dashed. Click one to create the note.
- **Backlinks.** Every note shows which notes link to it.
- **Safe renames.** Renaming a note updates every link that points to it.
- **Search.** Full-text, typo-tolerant, matches as you type. Shortcut: `Ctrl/⌘ K` or `/`.
- **Graph view.** Every note and link as an interactive map. Drag nodes, scroll or pinch to zoom, click to open.
- **Backup.** Export and import all notes as JSON from the `⋯` menu.
- Light and dark mode, and a phone layout.

## Sync with GitHub (stage 2, free)

Notes are stored in your browser (IndexedDB). To back them up and use them on several devices, sync them to a **private** GitHub repository:

1. Create a private repository, e.g. `atlas-notes`.
2. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to **only that repository** and the permission **Contents: Read and write**.
3. In Atlas, click **Sync** (top right), enter the repository and token, and click **Connect**. Do the same on your other devices.

Each note becomes a Markdown file in `notes/`, so GitHub keeps the full history and you can also open the notes in any editor (e.g. Obsidian).
If two devices change the same note, the changes are merged. If they changed the same lines, both versions are kept.
The token stays in your browser and is only ever sent to GitHub.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests
npm run build    # production build in dist/
```

## Deploy to GitHub Pages (free)

1. Make the repository public. On a free GitHub plan, Pages only works for public repos.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/deploy.yml` tests, builds and publishes the app to
   `https://<your-username>.github.io/<repo-name>/`.

## Roadmap

See [DESIGN.md](DESIGN.md). Atlas grows in stages, all on the same graph:
research importer, mind map, real-time collaboration, argument map, wiki from chats,
decision journal, recipes, and a city view.
