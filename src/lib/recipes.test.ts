import { describe, expect, it } from 'vitest';
import { meatIn, normalizeIngredient, readPantry, readRecipe, recipeFromHtml, similarRecipes, vegetarianSwaps, whatCanIMake } from './recipes';
import type { Note } from './types';

const note = (title: string, body: string): Note => ({ id: title, type: 'note', title, body, createdAt: 0, updatedAt: 0 });
const recipe = (title: string, ingredients: string[], extra = '', steps = '1. Boil the pasta.') =>
  note(title, `type:: recipe\n${extra}\n\n## Ingredients\n${ingredients.map((i) => `- ${i}`).join('\n')}\n\n## Steps\n${steps}`);

const carbonara = recipe('Carbonara', ['200 g spaghetti', '100 g guanciale, diced', '2 large eggs', '50 g pecorino, grated', 'black pepper'], 'cuisine:: Italian', '1. Boil the pasta.\n2. Fry the guanciale.');
const tomato = recipe('Tomato pasta', ['200 g spaghetti', '400 g tin of chopped tomatoes', '2 cloves garlic', 'fresh basil', 'olive oil'], 'cuisine:: Italian');
const omelette = recipe('Omelette', ['3 eggs', 'knob of butter', 'salt'], '', '1. Fry gently in a pan.');
const curry = recipe('Chicken curry', ['500 g chicken thighs', '1 tin coconut milk', '2 tbsp curry paste', 'rice'], 'cuisine:: Thai', '1. Simmer for 20 minutes.');

describe('ingredients', () => {
  it('normalises amounts, units, descriptors and plurals', () => {
    expect(normalizeIngredient('200 g cherry tomatoes, halved')).toBe('cherry tomato');
    expect(normalizeIngredient('2 tbsp extra-virgin olive oil')).toBe('olive oil');
    expect(normalizeIngredient('1 tin (400 g) of chopped tomatoes')).toBe('tomato');
    expect(normalizeIngredient('3 large eggs, beaten')).toBe('egg');
    expect(normalizeIngredient('a handful of fresh basil leaves')).toBe('basil leaf');
    expect(normalizeIngredient('[[Rice]]')).toBe('rice');
  });
  it('recognises meat and fish, but not their vegetarian versions', () => {
    expect(meatIn('chicken thigh')).toBe('chicken');
    expect(meatIn('guanciale')).toBe('guanciale');
    expect(meatIn('anchovies')).toBe('anchovy');
    expect(meatIn('vegetable stock')).toBeNull();
    expect(meatIn('chicken stock')).toBe('chicken');
    expect(meatIn('eggplant')).toBeNull();
  });
});

describe('recipes', () => {
  const all = [carbonara, tomato, omelette, curry].map(readRecipe).map((r) => r!);
  it('reads recipe notes', () => {
    const r = all[0];
    expect(r.ingredients).toEqual(['spaghetti', 'guanciale', 'egg', 'pecorino', 'black pepper']);
    expect(r).toMatchObject({ vegetarian: false, meat: ['guanciale'], cuisine: 'Italian', techniques: ['fry', 'boil'] });
    expect(all[1].vegetarian).toBe(true);
    expect(readRecipe(note('x', 'not a recipe'))).toBeNull();
  });
  it('ranks what can be made from the pantry', () => {
    const pantry = readPantry([note('Pantry', 'type:: pantry\n\n- eggs\n- spaghetti\n- garlic\n- tinned tomatoes\n- basil')]);
    expect(pantry).toEqual(['egg', 'spaghetti', 'garlic', 'tinned tomato', 'basil']);
    const m = whatCanIMake(all, pantry);
    expect(m.map((x) => [x.recipe.title, x.missing])).toEqual([
      ['Tomato pasta', []], // uses more of what you have
      ['Omelette', []],
      ['Carbonara', ['guanciale', 'pecorino']],
      ['Chicken curry', ['chicken thigh', 'coconut milk', 'curry paste', 'rice']],
    ]);
    expect(whatCanIMake(all, pantry, false)[0].recipe.title).toBe('Tomato pasta'); // omelette needs butter and salt
  });
  it('suggests vegetarian alternatives and swaps', () => {
    expect(similarRecipes(all[0], all, true).map((x) => x.recipe.title)).toEqual(['Tomato pasta', 'Omelette']);
    expect(vegetarianSwaps(all[3])).toEqual([{ ingredient: 'chicken thigh', swap: 'chickpeas, firm tofu or seitan' }]);
  });
});

describe('recipe web pages', () => {
  it('reads schema.org Recipe data from a saved page', () => {
    const html = `<html><head><link rel="canonical" href="https://food.example/pad-thai"><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'x' },
        {
          '@type': 'Recipe',
          name: 'Pad Thai',
          recipeYield: ['4 servings'],
          totalTime: 'PT1H5M',
          recipeCuisine: 'Thai',
          recipeIngredient: ['200 g rice noodles', '2 eggs', '<b>3 tbsp</b> fish sauce'],
          recipeInstructions: [{ '@type': 'HowToSection', itemListElement: [{ '@type': 'HowToStep', text: 'Soak the noodles.' }] }, { '@type': 'HowToStep', text: 'Stir-fry everything.' }],
        },
      ],
    })}</script></head><body></body></html>`;
    const r = recipeFromHtml(html)!;
    expect(r.title).toBe('Pad Thai');
    expect(r.body).toBe('type:: recipe\nserves:: 4\ntime:: 65 min\ncuisine:: Thai\nurl:: https://food.example/pad-thai\n\n## Ingredients\n- 200 g rice noodles\n- 2 eggs\n- 3 tbsp fish sauce\n\n## Steps\n1. Soak the noodles.\n2. Stir-fry everything.\n');
    const parsed = readRecipe(note(r.title, r.body))!;
    expect(parsed.meat).toEqual(['fish sauce']);
    expect(recipeFromHtml('<html><body>No recipe</body></html>')).toBeNull();
  });
});
