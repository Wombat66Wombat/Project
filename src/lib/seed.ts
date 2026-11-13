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
- Open **Views → Graph** to see how everything connects, or **Views → City** to walk through it in 3D.
- Try **New ▾** for templates (decisions, claims, recipes) and **Views → Import** to bring in PDFs, articles and chats.
- Everything is saved in this browser. Click **Sync** (top right) to back it up to GitHub and use it on all your devices.

For a tour of every feature, see the [[Roadmap]].`,
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
      `Everything Atlas can do, all built on the same linked notes. Each part is free and runs on your device.

1. **Notes, links, search, graph:** \`[[links]]\`, backlinks, and **Views → Graph** ✓
2. **Sync with GitHub:** **Sync** (top right) keeps notes as Markdown in a private repo ✓
3. **Smart search:** **⋯ → Smart search** finds notes by meaning, and each note shows related ones ✓
4. **Research:** **Views → Import** for PDFs, articles and YouTube transcripts; select text to save a claim with its citation; **Views → Ask** answers with sources ✓
5. **Mind map:** the **Map** tab on any note turns its headings and bullets into an editable map ✓
6. **Live together:** the **Live** button on a note gives you an invite link to edit it together in real time ✓
7. **Argument map:** the **Argue** tab shows reasons, objections and evidence, and flags weak points ✓
8. **Wiki from chats and email:** **Views → Import → Chats & email** ✓
9. **Decision journal:** **New ▾ → Decision**, then **Views → Decisions** shows how well calibrated you are ✓
10. **Recipes:** **New ▾ → Recipe** and **Pantry**, then **Views → Recipes**: what can I cook? ✓
11. **City:** **Views → City** shows your notes as a 3D city ✓

Related: [[Welcome to Atlas]], [[How links work]].`,
      1000,
    ),
  ];
}
