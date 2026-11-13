/**
 * Core data model. Stage 1 only uses `note`, but every future feature
 * (sources, claims, people, decisions, recipes…) is just another node type
 * in the same graph — see DESIGN.md.
 */
export type NodeType = 'note';

export interface Note {
  id: string;
  type: NodeType;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  /**
   * Front-matter lines Atlas doesn't use itself (e.g. Obsidian `tags:` or `aliases:`),
   * kept verbatim so syncing never drops them.
   */
  extra?: string;
}

export interface LinkRef {
  /** The raw target text inside [[ ]] (before any `|alias`). */
  target: string;
  /** Display text (alias if given, else the target). */
  label: string;
}

export interface GraphIndex {
  /** normalised title -> note */
  byTitle: Map<string, Note>;
  byId: Map<string, Note>;
  /** note id -> ids of notes it links to (resolved, de-duplicated) */
  outgoing: Map<string, Set<string>>;
  /** note id -> ids of notes that link to it */
  backlinks: Map<string, Set<string>>;
  /** note id -> link targets that don't match any note yet */
  unresolved: Map<string, Set<string>>;
}
