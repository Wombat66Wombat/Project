import type { Note } from './types';
import { getField, noteKind } from './fields';

export interface Recipe {
  id: string;
  title: string;
  /** Ingredient lines as written. */
  lines: string[];
  /** Normalised ingredient names ("200 g cherry tomatoes, halved" → "cherry tomato"). */
  ingredients: string[];
  steps: string[];
  serves: string;
  time: string;
  cuisine: string;
  tags: string[];
  techniques: string[];
  vegetarian: boolean;
  meat: string[];
}

const UNITS =
  /^(\d+([.,/]\d+)?|½|¼|¾|⅓|⅔|a|an|one|two|three|four|few|some|pinch|handful|dash|splash)?\s*(-\s*\d+\s*)?(g|gr|grams?|kg|mg|ml|l|litres?|liters?|cl|dl|oz|ounces?|lbs?|pounds?|cups?|tbsps?|tablespoons?|tsps?|teaspoons?|el|tl|cloves?|slices?|pieces?|cans?|tins?|jars?|packs?|packets?|bunch(es)?|sprigs?|stalks?|sticks?|heads?|pinch(es)?|handfuls?|dashes?|splashes?|knobs?|x)?\.?\s+(of\s+)?/i;
const DESCRIPTORS =
  /\b(fresh(ly)?|dried|chopped|finely|roughly|thinly|sliced|diced|minced|grated|crushed|ground|peeled|large|small|medium|big|ripe|frozen|cooked|raw|whole|boneless|skinless|extra[- ]virgin|organic|optional|to taste|softened|melted|beaten|halved|quartered|cubed|shredded|toasted|plain|good[- ]quality|about|approx\.?|for serving|for frying|plus more)\b/gi;

/** Singular form for common English plurals. */
export function singular(w: string): string {
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(tomato|potato)es$/.test(w)) return w.slice(0, -2);
  if (/(ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (/leaves$/.test(w)) return w.slice(0, -6) + 'leaf';
  if (/s$/.test(w) && !/(rice|couscous|hummus|asparagus|molasses|swiss|grass)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** "200 g cherry tomatoes, halved (optional)" → "cherry tomato" */
export function normalizeIngredient(line: string): string {
  let s = line
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;–—]| - | or /)[0];
  for (let i = 0; i < 3; i++) s = s.trim().replace(UNITS, '');
  s = s.replace(DESCRIPTORS, ' ').replace(/[^\p{L}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return s.split(' ').map(singular).join(' ');
}

const MEAT = [
  'chicken', 'beef', 'pork', 'bacon', 'ham', 'lamb', 'mutton', 'turkey', 'duck', 'goose', 'veal', 'venison', 'rabbit', 'sausage',
  'salami', 'prosciutto', 'pancetta', 'guanciale', 'chorizo', 'pepperoni', 'mince', 'steak', 'meatball', 'gelatin', 'gelatine',
  'lard', 'anchovy', 'tuna', 'salmon', 'cod', 'trout', 'sardine', 'mackerel', 'fish', 'shrimp', 'prawn', 'crab', 'lobster',
  'mussel', 'clam', 'oyster', 'scallop', 'squid', 'octopus', 'speck', 'hähnchen', 'huhn', 'rind', 'schwein', 'schinken', 'lachs',
  'thunfisch', 'wurst', 'poulet', 'boeuf', 'porc', 'jambon', 'poisson', 'worcestershire', 'fish sauce', 'oyster sauce',
];
// Words that contain a meat word but aren't meat.
const NOT_MEAT = /\b(vegetable stock|veggie|vegan|vegetarian|plant[- ]based|meatless|egg ?plant|fish ?less|vegan worcestershire)\b/;

// Longest names first, so "fish sauce" is found before "fish".
const MEAT_BY_LENGTH = [...MEAT].sort((a, b) => b.length - a.length);

export function meatIn(ingredient: string): string | null {
  if (NOT_MEAT.test(ingredient)) return null;
  const words = ingredient.toLowerCase().split(/\s+/).map(singular).join(' ');
  for (const m of MEAT_BY_LENGTH) if (new RegExp(`\\b${m}s?\\b`).test(words)) return m;
  if (/\b(chicken|beef|fish|bone) (stock|broth)\b/.test(ingredient)) return 'stock';
  return null;
}

const TECHNIQUES: [string, RegExp][] = [
  ['bake', /\bbak(e|ed|ing)\b|\boven\b/i],
  ['roast', /\broast/i],
  ['fry', /\b(fry|fried|frying|sauté|saute|stir[- ]fry)/i],
  ['simmer', /\bsimmer|\bstew|\bbraise/i],
  ['boil', /\bboil/i],
  ['grill', /\bgrill|\bbarbecue|\bbbq/i],
  ['steam', /\bsteam/i],
  ['blend', /\bblend|\bpuree|\bpurée/i],
  ['knead', /\bknead|\bdough|\bproof/i],
  ['raw', /\bno[- ]cook|\btoss\b/i],
];

function section(body: string, names: RegExp): string[] {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && names.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (m && m[1].trim()) out.push(m[1].trim());
  }
  return out;
}

export function readRecipe(n: Note): Recipe | null {
  if (noteKind(n.body) !== 'recipe') return null;
  const lines = section(n.body, /ingredient|zutaten|ingrédients/i);
  const steps = section(n.body, /step|method|instruction|direction|zubereitung|préparation/i);
  const ingredients = [...new Set(lines.map(normalizeIngredient).filter(Boolean))];
  const meat = [...new Set(ingredients.map(meatIn).filter((m): m is string => !!m))];
  const text = steps.join(' ');
  const tags = (getField(n.body, 'tags') ?? '').split(/[,#]/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  return {
    id: n.id,
    title: n.title,
    lines,
    ingredients,
    steps,
    serves: getField(n.body, 'serves') ?? '',
    time: getField(n.body, 'time') ?? '',
    cuisine: (getField(n.body, 'cuisine') ?? '').trim(),
    tags,
    techniques: TECHNIQUES.filter(([, re]) => re.test(text)).map(([t]) => t),
    vegetarian: meat.length === 0 && ingredients.length > 0,
    meat,
  };
}

/** Basics most kitchens have; counted as available when "assume basics" is on. */
export const BASICS = ['salt', 'pepper', 'black pepper', 'water', 'oil', 'olive oil', 'vegetable oil', 'sugar', 'butter', 'flour'];

/** Ingredient names from the pantry note (one per list item). */
export function readPantry(notes: Note[]): string[] {
  const p = notes.find((n) => noteKind(n.body) === 'pantry');
  if (!p) return [];
  return [...new Set(p.body.split('\n').map((l) => /^\s*[-*+]\s+(.*)$/.exec(l)?.[1] ?? '').filter(Boolean).map(normalizeIngredient).filter(Boolean))];
}

/** Does the pantry hold this ingredient? Loose: "cherry tomato" is covered by "tomato" and vice versa. */
export function have(ingredient: string, pantry: string[]): boolean {
  return pantry.some((p) => p === ingredient || ingredient.endsWith(` ${p}`) || p.endsWith(` ${ingredient}`) || ingredient === `${p}s`);
}

export interface Match {
  recipe: Recipe;
  missing: string[];
  haveCount: number;
}

/** Recipes ranked by how much of them you can make from the pantry: complete ones first, then fewest missing. */
export function whatCanIMake(recipes: Recipe[], pantry: string[], assumeBasics = true): Match[] {
  const stock = assumeBasics ? [...pantry, ...BASICS] : pantry;
  return recipes
    .filter((r) => r.ingredients.length)
    .map((r) => {
      const missing = r.ingredients.filter((i) => !have(i, stock));
      return { recipe: r, missing, haveCount: r.ingredients.length - missing.length };
    })
    .sort((a, b) => a.missing.length - b.missing.length || b.haveCount - a.haveCount || a.recipe.title.localeCompare(b.recipe.title));
}

/** Similarity of two recipes: shared ingredients (Jaccard), plus a little for cuisine and technique. */
export function similarity(a: Recipe, b: Recipe): number {
  const A = new Set(a.ingredients);
  const B = new Set(b.ingredients);
  const inter = [...A].filter((x) => B.has(x) || [...B].some((y) => y.endsWith(` ${x}`) || x.endsWith(` ${y}`))).length;
  const union = new Set([...A, ...B]).size || 1;
  let s = inter / union;
  if (a.cuisine && a.cuisine.toLowerCase() === b.cuisine.toLowerCase()) s += 0.15;
  s += 0.05 * a.techniques.filter((t) => b.techniques.includes(t)).length;
  s += 0.05 * a.tags.filter((t) => b.tags.includes(t)).length;
  return s;
}

export function similarRecipes(r: Recipe, all: Recipe[], onlyVegetarian = false, limit = 4): { recipe: Recipe; score: number }[] {
  return all
    .filter((o) => o.id !== r.id && (!onlyVegetarian || o.vegetarian))
    .map((o) => ({ recipe: o, score: similarity(r, o) }))
    .filter((x) => x.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

const SWAPS: Record<string, string> = {
  chicken: 'chickpeas, firm tofu or seitan',
  beef: 'mushrooms, lentils or plant-based mince',
  mince: 'cooked lentils or plant-based mince',
  pork: 'smoked tofu or jackfruit',
  bacon: 'smoked tofu, or smoked paprika for the flavour',
  pancetta: 'smoked tofu, or smoked paprika for the flavour',
  guanciale: 'smoked tofu with a little extra salt',
  ham: 'smoked tofu',
  sausage: 'vegetarian sausages',
  chorizo: 'smoked paprika with chickpeas',
  lamb: 'aubergine or mushrooms',
  turkey: 'tofu or tempeh',
  fish: 'tofu, aubergine or king oyster mushrooms',
  salmon: 'marinated tofu or carrot "lox"',
  tuna: 'mashed chickpeas',
  shrimp: 'king oyster mushrooms or tofu',
  prawn: 'king oyster mushrooms or tofu',
  anchovy: 'capers or miso',
  'fish sauce': 'soy sauce with a little seaweed',
  'oyster sauce': 'mushroom "oyster" sauce',
  worcestershire: 'vegan Worcestershire sauce',
  gelatin: 'agar-agar',
  gelatine: 'agar-agar',
  stock: 'vegetable stock',
  lard: 'butter or vegetable shortening',
};

/** Vegetarian swaps for the meat and fish in a recipe. */
export function vegetarianSwaps(r: Recipe): { ingredient: string; swap: string }[] {
  return r.ingredients
    .map((i) => ({ i, m: meatIn(i) }))
    .filter((x): x is { i: string; m: string } => !!x.m)
    .map(({ i, m }) => ({ ingredient: i, swap: SWAPS[m] ?? 'a vegetable or legume with a similar texture' }));
}

/** A schema.org Recipe embedded in a saved recipe web page, as Markdown for a recipe note. */
export function recipeFromHtml(html: string): { title: string; body: string } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const find = (x: unknown): Record<string, unknown> | null => {
    if (Array.isArray(x)) {
      for (const y of x) {
        const r = find(y);
        if (r) return r;
      }
      return null;
    }
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    const t = o['@type'];
    if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return o;
    return find(o['@graph']);
  };
  let recipe: Record<string, unknown> | null = null;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      recipe = find(JSON.parse(s.textContent ?? ''));
    } catch {
      /* skip broken JSON-LD */
    }
    if (recipe) break;
  }
  if (!recipe) return null;
  const text = (v: unknown): string => (typeof v === 'string' ? new DOMParser().parseFromString(v, 'text/html').body.textContent?.trim() ?? '' : '');
  const list = (v: unknown): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((x) => text(x)).filter(Boolean);
  const steps = (v: unknown): string[] =>
    (Array.isArray(v) ? v : v ? [v] : []).flatMap((s) => {
      if (typeof s === 'string') return [text(s)];
      const o = s as Record<string, unknown>;
      if (o['@type'] === 'HowToSection') return steps(o.itemListElement);
      return [text(o.text ?? o.name)];
    }).filter(Boolean);
  const minutes = (iso: unknown) => {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(String(iso ?? ''));
    if (!m) return '';
    const t = (+(m[1] ?? 0)) * 60 + +(m[2] ?? 0);
    return t ? `${t} min` : '';
  };
  const yieldText = Array.isArray(recipe.recipeYield) ? text(recipe.recipeYield[0]) : text(recipe.recipeYield);
  const cuisine = list(recipe.recipeCuisine).join(', ');
  const url = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  const fields = [
    'type:: recipe',
    yieldText && `serves:: ${yieldText.replace(/\s*(servings?|portions?)$/i, '')}`,
    minutes(recipe.totalTime ?? recipe.cookTime) && `time:: ${minutes(recipe.totalTime ?? recipe.cookTime)}`,
    cuisine && `cuisine:: ${cuisine}`,
    url && `url:: ${url}`,
  ].filter(Boolean);
  const ing = list(recipe.recipeIngredient);
  const st = steps(recipe.recipeInstructions);
  if (!ing.length) return null;
  return {
    title: text(recipe.name) || doc.title || 'Recipe',
    body: `${fields.join('\n')}\n\n## Ingredients\n${ing.map((i) => `- ${i}`).join('\n')}\n\n## Steps\n${st.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`,
  };
}
