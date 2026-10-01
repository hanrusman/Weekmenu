import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-meal-check.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { mealCheckOf, CARBS_MINIMUM, PROTEIN_MINIMUM } = await import('../server/services/meal-check');
const { saveRecipe, parseRecipeInput, getRecipe, listRecipes } = await import('../server/services/recipes');

type Ingredient = { name: string; amount: number | string | null; unit: string; product_group: string };
const i = (name: string, amount: number, unit: string, product_group: string): Ingredient => ({ name, amount, unit, product_group });
const check = (ingredients: Ingredient[], servings = 4) => mealCheckOf(getDb(), ingredients, servings);

beforeAll(() => {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

afterAll(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(() => {
  getDb().exec('DELETE FROM recipe_ingredients; DELETE FROM recipes; DELETE FROM ingredient_conversions; DELETE FROM ingredients;');
});

describe('whole meal check', () => {
  it('asks at least 30 g carbohydrate and 15 g protein per serving', () => {
    expect([CARBS_MINIMUM, PROTEIN_MINIMUM]).toEqual([30, 15]);
  });

  it('finds a green salad with an egg no whole meal', () => {
    expect(check([
      i('gemengde sla', 200, 'g', 'groenten'), i('sperziebonen', 300, 'g', 'groenten'),
      i('ei', 4, 'stuks', 'zuivel'), i('avocado', 2, 'stuks', 'groenten'),
    ])).toEqual({ carbs_per_serving: 0, protein_per_serving: 7, missing: ['koolhydraten', 'eiwit'] });
  });

  it('counts pasta and prawns as a whole meal, and a pesto pasta as short on protein', () => {
    // 400 g pasta: 65 % carbohydrate, 12 % protein; prawns as fish, 20 %
    expect(check([i('volkoren spaghetti', 400, 'g', 'droogwaren'), i('garnalen', 300, 'g', 'vis')]))
      .toEqual({ carbs_per_serving: 65, protein_per_serving: 27, missing: [] });
    expect(check([i('penne', 400, 'g', 'droogwaren'), i('groene pesto', 100, 'g', 'sauzen')]).missing).toEqual(['eiwit']);
  });

  it('counts tinned pulses as cooked and dry ones as dry', () => {
    const tinned = check([i('kikkererwten uit blik', 400, 'g', 'droogwaren')]);
    const dry = check([i('rode linzen', 400, 'g', 'droogwaren')]);
    expect(tinned).toMatchObject({ carbs_per_serving: 13, protein_per_serving: 7 });
    expect(dry).toMatchObject({ carbs_per_serving: 50, protein_per_serving: 24 });
  });

  it('weighs what is counted in pieces: eggs, wraps, slices of bread, lasagne sheets', () => {
    expect(check([i('volkoren wraps', 8, 'stuks', 'brood')]).carbs_per_serving).toBe(54); // 8 × 60 g × 45 %
    expect(check([i('volkoren brood', 8, 'snee', 'brood')]).carbs_per_serving).toBe(32); // 8 × 35 g × 45 %
    expect(check([i('lasagnebladen', 12, 'stuks', 'droogwaren')]).carbs_per_serving).toBe(33); // 12 × 17 g × 65 %
    expect(check([i('ei', 8, 'stuks', 'zuivel')]).protein_per_serving).toBe(14); // 8 × 55 g × 12,5 %
    expect(check([i('kipfilet', 4, 'stuks', 'vlees')]).protein_per_serving).toBe(25); // 125 g × 20 %
  });

  it('counts fish and meat filed with frozen food by name, but not a stock named after them', () => {
    expect(check([i('vissticks', 12, 'stuks', 'diepvries')]).protein_per_serving).toBe(12); // 12 × 30 g × 13 %
    expect(check([i('diepvries kabeljauwfilet', 400, 'g', 'diepvries')]).protein_per_serving).toBe(20);
    expect(check([i('kip- of groentebouillon', 1000, 'ml', 'overig')]).protein_per_serving).toBe(0);
  });

  it('does not take vinegar, breadcrumbs or stock for a carbohydrate source, but floury potatoes it does', () => {
    expect(check([
      i('rijstazijn', 2, 'el', 'sauzen'), i('paneermeel', 100, 'g', 'droogwaren'), i('kippenbouillon', 500, 'ml', 'overig'),
    ]).carbs_per_serving).toBe(0);
    expect(check([i('kruimige aardappelen', 1000, 'g', 'groenten')]).carbs_per_serving).toBe(38);
  });

  it('counts sweet potato lighter on carbohydrate than pasta, and leaves currypasta out', () => {
    expect(check([i('zoete aardappel', 800, 'g', 'groenten')]).carbs_per_serving).toBe(40);
    expect(check([i('rode currypasta', 100, 'g', 'sauzen')]).carbs_per_serving).toBe(0);
  });
});

describe('on recipes', () => {
  const save = (name: string, ingredients: Ingredient[], extra: Record<string, unknown> = {}) =>
    saveRecipe(getDb(), parseRecipeInput({ name, servings: 4, ingredients, steps: ['Koken'], ...extra }));

  it('says what a dinner lacks, and holds nothing else to it', () => {
    const salad = save('Groene salade', [i('gemengde sla', 200, 'g', 'groenten'), i('feta', 100, 'g', 'zuivel')]);
    const side = save('Groene salade erbij', [i('gemengde sla', 200, 'g', 'groenten')], { course: 'bijgerecht' });

    expect(getRecipe(getDb(), salad)).toMatchObject({ carbs_per_serving: 0, protein_per_serving: 4, meal_missing: ['koolhydraten', 'eiwit'] });
    expect(listRecipes(getDb(), {}).find((r) => r.id === side)).toMatchObject({ course: 'bijgerecht', meal_missing: [] });
  });
});
