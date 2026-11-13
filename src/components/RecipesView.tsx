import { useMemo, useState } from 'react';
import type { Atlas } from '../lib/useAtlas';
import type { Note } from '../lib/types';
import { readPantry, readRecipe, similarRecipes, vegetarianSwaps, whatCanIMake, type Recipe } from '../lib/recipes';
import { noteKind } from '../lib/fields';
import { navigate, noteHref } from '../lib/router';

interface Props {
  atlas: Atlas;
  onNew: () => void;
  onNewPantry: () => void;
}

/** Add items to the "Shopping list" note (created if needed), skipping ones already on it. */
export function addToShoppingList(atlas: Atlas, items: string[]): Note {
  let list = atlas.notes.find((n) => noteKind(n.body) === 'shopping');
  if (!list) list = atlas.add('Shopping list', 'type:: shopping\n\n');
  const have = new Set(list.body.split('\n').map((l) => /^\s*-\s+(?:\[[ x]\]\s+)?(.*)$/.exec(l)?.[1]?.trim().toLowerCase()).filter(Boolean));
  const fresh = items.filter((i) => !have.has(i.toLowerCase()));
  if (fresh.length) atlas.updateBody(list.id, `${list.body.replace(/\s+$/, '')}\n${fresh.map((i) => `- [ ] ${i}`).join('\n')}\n`);
  return list;
}

function RecipeBadges({ r }: { r: Recipe }) {
  return (
    <span className="badges">
      {r.vegetarian && <span className="badge veg">vegetarian</span>}
      {r.time && <span className="badge">{r.time}</span>}
      {r.cuisine && <span className="badge">{r.cuisine}</span>}
      {r.techniques.slice(0, 2).map((t) => (
        <span key={t} className="badge">
          {t}
        </span>
      ))}
    </span>
  );
}

/** Recipes: what you can cook with what you have, and all recipes by ingredient, cuisine and diet. */
export function RecipesView({ atlas, onNew, onNewPantry }: Props) {
  const recipes = useMemo(() => atlas.notes.map(readRecipe).filter((r): r is Recipe => !!r), [atlas.notes]);
  const pantry = useMemo(() => readPantry(atlas.notes), [atlas.notes]);
  const pantryNote = atlas.notes.find((n) => noteKind(n.body) === 'pantry');
  const [basics, setBasics] = useState(true);
  const [vegOnly, setVegOnly] = useState(false);
  const [cuisine, setCuisine] = useState('');
  const [ingredient, setIngredient] = useState('');
  const [added, setAdded] = useState<Record<string, boolean>>({});

  const matches = useMemo(() => whatCanIMake(recipes, pantry, basics), [recipes, pantry, basics]);
  const ready = matches.filter((m) => m.missing.length === 0);
  const almost = matches.filter((m) => m.missing.length > 0 && m.missing.length <= 2);
  const cuisines = [...new Set(recipes.map((r) => r.cuisine).filter(Boolean))].sort();
  const topIngredients = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of recipes) for (const i of r.ingredients) c.set(i, (c.get(i) ?? 0) + 1);
    return [...c.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 14);
  }, [recipes]);
  const q = ingredient.trim().toLowerCase();
  const shown = recipes
    .filter((r) => (!vegOnly || r.vegetarian) && (!cuisine || r.cuisine === cuisine) && (!q || r.ingredients.some((i) => i.includes(q)) || r.title.toLowerCase().includes(q)))
    .sort((a, b) => a.title.localeCompare(b.title));

  if (recipes.length === 0) {
    return (
      <section className="screen">
        <h1>Recipes</h1>
        <div className="empty card">
          <p>
            <strong>Collect recipes as notes.</strong> Atlas reads their ingredients, tells you what you can cook from your
            pantry, and suggests vegetarian alternatives.
          </p>
          <p className="muted small">Write one from the template, or import a saved recipe page (Import → Web article): most recipe sites include the recipe in a form Atlas can read.</p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={onNew}>
              + New recipe
            </button>
            <a className="btn" href="#/import">
              Import a recipe page
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="screen">
      <div className="screen-head">
        <h1>Recipes</h1>
        <button className="btn" onClick={() => (pantryNote ? navigate(noteHref(pantryNote.id)) : onNewPantry())}>
          {pantryNote ? 'Edit pantry' : '+ Pantry'}
        </button>
        <button className="btn primary" onClick={onNew}>
          + New recipe
        </button>
      </div>

      <section className="dec-section">
        <h2>What can I make?</h2>
        {!pantryNote ? (
          <p className="muted">
            <button className="linklike" onClick={onNewPantry}>
              Add a Pantry note
            </button>{' '}
            listing what’s in your kitchen, and Atlas will show what you can cook.
          </p>
        ) : (
          <>
            <label className="check small">
              <input type="checkbox" checked={basics} onChange={(e) => setBasics(e.target.checked)} /> Assume basics (salt, pepper, oil, butter, flour, sugar, water)
            </label>
            {ready.length === 0 && almost.length === 0 && <p className="muted">Nothing yet with what’s in your pantry. Add more to it, or more recipes.</p>}
            {ready.length > 0 && (
              <>
                <h3 className="sub">Ready to cook</h3>
                <ul className="cards recipe-grid">
                  {ready.map((m) => (
                    <li key={m.recipe.id} className="card recipe-card ready">
                      <a href={noteHref(m.recipe.id)} className="dec-title">
                        {m.recipe.title}
                      </a>
                      <RecipeBadges r={m.recipe} />
                      <span className="small ok-text">✓ You have everything</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {almost.length > 0 && (
              <>
                <h3 className="sub">Almost there</h3>
                <ul className="cards recipe-grid">
                  {almost.map((m) => (
                    <li key={m.recipe.id} className="card recipe-card">
                      <a href={noteHref(m.recipe.id)} className="dec-title">
                        {m.recipe.title}
                      </a>
                      <RecipeBadges r={m.recipe} />
                      <span className="small">Missing: {m.missing.join(', ')}</span>
                      {added[m.recipe.id] ? (
                        <span className="small muted">Added to shopping list ✓</span>
                      ) : (
                        <button
                          className="linklike small"
                          onClick={() => {
                            addToShoppingList(atlas, m.missing);
                            setAdded((a) => ({ ...a, [m.recipe.id]: true }));
                          }}
                        >
                          + add to shopping list
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="dec-section">
        <h2>All recipes ({recipes.length})</h2>
        <div className="filters">
          <input value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="Ingredient or name…" aria-label="Filter by ingredient or name" />
          {cuisines.length > 0 && (
            <select value={cuisine} onChange={(e) => setCuisine(e.target.value)} aria-label="Cuisine">
              <option value="">All cuisines</option>
              {cuisines.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
          <label className="check small">
            <input type="checkbox" checked={vegOnly} onChange={(e) => setVegOnly(e.target.checked)} /> Vegetarian only
          </label>
        </div>
        {topIngredients.length > 0 && (
          <div className="ing-chips" aria-label="Common ingredients">
            {topIngredients.map(([i, n]) => (
              <button key={i} className={`chip-mini ${q === i ? 'on' : ''}`} onClick={() => setIngredient(q === i ? '' : i)}>
                {i} <span className="muted">{n}</span>
              </button>
            ))}
          </div>
        )}
        <ul className="cards recipe-grid">
          {shown.map((r) => (
            <li key={r.id} className="card recipe-card">
              <a href={noteHref(r.id)} className="dec-title">
                {r.title}
              </a>
              <RecipeBadges r={r} />
              <span className="small muted">{r.ingredients.slice(0, 6).join(', ')}{r.ingredients.length > 6 ? '…' : ''}</span>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="muted">No recipes match.</p>}
      </section>
    </section>
  );
}

/** Shown on a recipe note: can I cook it, vegetarian swaps, and similar recipes. */
export function RecipeTools({ atlas, note }: { atlas: Atlas; note: Note }) {
  const recipe = useMemo(() => readRecipe(note), [note]);
  const all = useMemo(() => atlas.notes.map(readRecipe).filter((r): r is Recipe => !!r), [atlas.notes]);
  const pantry = useMemo(() => readPantry(atlas.notes), [atlas.notes]);
  const [added, setAdded] = useState(false);
  if (!recipe || recipe.ingredients.length === 0) return null;
  const match = pantry.length ? whatCanIMake([recipe], pantry)[0] : null;
  const swaps = vegetarianSwaps(recipe);
  const vegAlts = recipe.vegetarian ? [] : similarRecipes(recipe, all, true, 3);
  const shownAlready = new Set(vegAlts.map((v) => v.recipe.id));
  const similar = similarRecipes(recipe, all, false, 6).filter((v) => !shownAlready.has(v.recipe.id)).slice(0, 4);
  return (
    <section className="card keypoints recipe-tools">
      <h2>Recipe tools</h2>
      {match && (
        <p className="small">
          {match.missing.length === 0 ? (
            <span className="ok-text">✓ You have everything in your pantry.</span>
          ) : (
            <>
              You have {match.haveCount} of {recipe.ingredients.length} ingredients. Missing: {match.missing.join(', ')}.{' '}
              {added ? (
                <span className="muted">Added to shopping list ✓</span>
              ) : (
                <button
                  className="linklike"
                  onClick={() => {
                    addToShoppingList(atlas, match.missing);
                    setAdded(true);
                  }}
                >
                  Add to shopping list
                </button>
              )}
            </>
          )}
        </p>
      )}
      {recipe.vegetarian ? (
        <p className="small">
          <span className="badge veg">vegetarian</span> No meat or fish found in the ingredients.
        </p>
      ) : (
        <>
          <p className="small">
            <strong>Make it vegetarian:</strong>
          </p>
          <ul className="small swaps">
            {swaps.map((s) => (
              <li key={s.ingredient}>
                Instead of <strong>{s.ingredient}</strong>, try {s.swap}.
              </li>
            ))}
          </ul>
          {vegAlts.length > 0 && (
            <p className="small">
              Vegetarian recipes like this:{' '}
              {vegAlts.map((v) => (
                <a key={v.recipe.id} className="chip-mini" href={noteHref(v.recipe.id)}>
                  {v.recipe.title}
                </a>
              ))}
            </p>
          )}
        </>
      )}
      {similar.length > 0 && (
        <p className="small">
          Similar recipes:{' '}
          {similar.map((v) => (
            <a key={v.recipe.id} className="chip-mini" href={noteHref(v.recipe.id)}>
              {v.recipe.title}
            </a>
          ))}
        </p>
      )}
    </section>
  );
}
