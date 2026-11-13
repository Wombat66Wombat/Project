const STOP = new Set(
  `the a an and or but if then so of to in on at by for from with about into over after before under between
  is are was were be been being am do does did done have has had having can could should would will shall may might must
  i me my mine you your yours he him his she her hers it its we us our ours they them their theirs this that these those
  there here what which who whom whose when where why how all any both each few more most other some such no nor not
  only own same than too very just also even still yet ever never again once now then really maybe perhaps please thanks
  thank hello hi hey yes yeah okay ok sure like get got make made want need know think thing things way something anything
  one two three use using used help let lets going go see say said tell try give take look looks good great well much many
  new time today tomorrow yesterday day days week weeks year years first last next back right left lot bit kind sort
  re fwd sent wrote message email mail subject regards best cheers dear team gmail com www http https
  here's i'm i've it's don't can't you're that's what's there's isn't won't didn't doesn't let's
  der die das und oder aber wenn dann von zu im in auf mit für ist sind war ich du er sie es wir ihr nicht ein eine einen
  le la les et ou mais de des du un une est sont pour avec dans sur pas je tu il elle nous vous`.split(/\s+/),
);

const tokens = (text: string) =>
  (text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'’-]*[\p{L}\p{N}]/gu) ?? []).map((t) => t.replace(/[’]/g, "'")).filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));

export interface Doc {
  id: string;
  text: string;
}

/**
 * Topics shared across documents, by TF-IDF: words and two-word phrases that are frequent in a
 * document, appear in at least two documents (so they connect things), and aren't so common
 * they say nothing. Returns up to `perDoc` topics per document.
 */
export function extractTopics(docs: Doc[], perDoc = 3, maxTopics = 60): Map<string, string[]> {
  const termsOf = docs.map((d) => {
    const t = tokens(d.text);
    const tf = new Map<string, number>();
    for (let i = 0; i < t.length; i++) {
      tf.set(t[i], (tf.get(t[i]) ?? 0) + 1);
      if (i + 1 < t.length) {
        const bi = `${t[i]} ${t[i + 1]}`;
        tf.set(bi, (tf.get(bi) ?? 0) + 1.5); // phrases are more specific than single words
      }
    }
    return { id: d.id, tf, len: Math.max(1, t.length) };
  });
  const df = new Map<string, number>();
  for (const d of termsOf) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  // Words in nearly every document say little; how "nearly" depends on collection size
  // (in a handful of chats, the main subject may well be in most of them).
  const maxDf = n <= 4 ? n : Math.max(3, Math.floor(n * (n < 30 ? 0.85 : 0.4)));
  const scored = termsOf.map((d) => {
    const s: [string, number][] = [];
    for (const [t, c] of d.tf) {
      const f = df.get(t)!;
      if (f < 2 || f > maxDf || c < 2) continue;
      s.push([t, (c / d.len) * Math.log(1 + n / f)]);
    }
    s.sort((a, b) => b[1] - a[1]);
    // Prefer a phrase over the words inside it.
    const picked: string[] = [];
    for (const [t] of s) {
      if (picked.some((p) => p.includes(t) || t.includes(p))) continue;
      picked.push(t);
      if (picked.length >= perDoc) break;
    }
    return { id: d.id, picked };
  });
  // Keep the topics that link the most documents.
  const usage = new Map<string, number>();
  for (const d of scored) for (const t of d.picked) usage.set(t, (usage.get(t) ?? 0) + 1);
  const keep = new Set([...usage.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, maxTopics).map(([t]) => t));
  return new Map(scored.map((d) => [d.id, d.picked.filter((t) => keep.has(t))]));
}

export const topicTitle = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Sentences that record a decision ("we decided…", "let's go with…"). */
export function findDecisions(text: string): string[] {
  const out: string[] = [];
  const re = /\b(we|i)\s+(have\s+)?(decided|agreed|chose|settled on|are going to go with|'ll go with|will go with)\b|\blet'?s go with\b|\bdecision\s*:|\bwe('ll| will) (use|go|move|switch|launch|hire|buy)\b|\b(wir haben|ich habe) (uns )?(entschieden|beschlossen)\b|\bnous avons décidé\b/i;
  for (const s of text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ"“])/)) {
    const t = s.trim();
    if (t.length >= 15 && t.length <= 300 && re.test(t) && !/\?$/.test(t)) out.push(t);
  }
  return out;
}
