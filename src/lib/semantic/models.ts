/** Embedding models Atlas can use. Both run fully in the browser; the model downloads once and is cached. */
export interface ModelInfo {
  key: ModelKey;
  /** Hugging Face model id (ONNX weights published for transformers.js). */
  id: string;
  label: string;
  description: string;
  sizeMB: number;
  /** Text prefixes some models were trained with (e5: "query: " / "passage: "). */
  queryPrefix: string;
  passagePrefix: string;
  /**
   * A match must clear both bars: an absolute similarity, and a "lift" above the average
   * similarity of the query to all notes. The lift matters for models like e5 whose scores
   * all sit in a narrow band (0.75–0.9), where an absolute cut-off alone can't tell
   * related from unrelated. Calibrated on a labelled set of 30 notes and 40 queries in
   * English, German and French (see DESIGN.md): the best balance of finding relevant notes
   * and avoiding wrong ones (≥75% precision), with no results at all for unrelated queries.
   */
  minScore: number;
  minLift: number;
  /** Results must also score within this much of the best match. */
  maxGap: number;
  /** The same two bars for note-to-note "Related" suggestions, calibrated separately. */
  relMinScore: number;
  relMinLift: number;
}

export type ModelKey = 'en' | 'multi';

export const MODELS: Record<ModelKey, ModelInfo> = {
  en: {
    key: 'en',
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'English',
    description: 'Fast and accurate for notes in English.',
    sizeMB: 23,
    queryPrefix: '',
    passagePrefix: '',
    minScore: 0.26,
    minLift: 0.17,
    maxGap: 0.15,
    relMinScore: 0.39,
    relMinLift: 0,
  },
  multi: {
    key: 'multi',
    id: 'Xenova/multilingual-e5-small',
    label: 'All languages',
    description: 'Understands 100+ languages, and finds matches across languages (e.g. German ↔ English).',
    sizeMB: 118,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    minScore: 0.82,
    minLift: 0.035,
    maxGap: 1,
    relMinScore: 0.7,
    relMinLift: 0.05,
  },
};

export const DIMS = 384;
