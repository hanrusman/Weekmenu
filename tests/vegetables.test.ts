import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-vegetables.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { isVegetable, vegetableScores, vegetableScoreOf } = await import('../server/services/vegetables');
const { saveRecipe, parseRecipeInput, getRecipe, listRecipes, updateRecipe } = await import('../server/services/recipes');
const { setConversion } = await import('../server/services/ingredient-admin');

type Ingredient = { name: string; amount: number | string | null; unit: string; product_group: string };

function recipe(name: string, ingredients: Ingredient[], extra: Record<string, unknown> = {}) {
  return saveRecipe(getDb(), parseRecipeInput({ name, servings: 4, ingredients, steps: ['Koken'], ...extra }));
}

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

describe('what counts as vegetable', () => {
  it('counts vegetables, also tinned tomatoes, passata and frozen ones filed elsewhere', () => {
    expect(isVegetable('courgette', 'groenten')).toBe(true);
    expect(isVegetable('tomatenblokjes uit blik', 'sauzen')).toBe(true);
    expect(isVegetable('passata', 'sauzen')).toBe(true);
    expect(isVegetable('diepvriesspinazie', 'diepvries')).toBe(true);
    expect(isVegetable('sperziebonen', 'groenten')).toBe(true);
    expect(isVegetable('avocado', 'groenten')).toBe(true);
  });

  it('counts a vegetable purée, but not tomato purée (a concentrate)', () => {
    expect(isVegetable('bloemkoolpuree', 'groenten')).toBe(true);
    expect(isVegetable('wortelpuree', 'groenten')).toBe(true);
    expect(isVegetable('tomatenpuree', 'sauzen')).toBe(false);
  });

  it('leaves out potatoes, pulses, olives, citrus, aromatics, herbs and spices', () => {
    for (const name of ['aardappel', 'krieltjes', 'kikkererwten', 'witte bonen uit blik', 'rode linzen', 'olijven',
      'citroen', 'knoflook', 'verse gember', 'rode chili', 'krulpeterselie', 'tomatenpuree', 'gerookte paprika']) {
      expect(isVegetable(name, 'groenten'), name).toBe(false);
    }
    expect(isVegetable('groene pesto', 'sauzen')).toBe(false);
  });
});

describe('vegetable score', () => {
  it('weighs grams, pieces, tins and millilitres per serving', () => {
    const id = recipe('Ovenschotel', [
      { name: 'courgette', amount: 500, unit: 'g', product_group: 'groenten' },
      { name: 'paprika', amount: 2, unit: 'stuks', product_group: 'groenten' }, // 2 x 150 g
      { name: 'tomatenblokjes uit blik', amount: 1, unit: 'blik', product_group: 'sauzen' }, // 400 g
      { name: 'passata', amount: 200, unit: 'ml', product_group: 'sauzen' },
      { name: 'aardappel', amount: 800, unit: 'g', product_group: 'groenten' }, // not a vegetable
      { name: 'zout', amount: null, unit: '', product_group: 'kruiden' },
    ]);
    expect(vegetableScores(getDb()).get(id)).toEqual({ per_serving: 350, unweighed: [] });
  });

  it('uses a conversion set for the ingredient', () => {
    const id = recipe('Salade', [{ name: 'artisjokharten in olie', amount: 1, unit: 'pot', product_group: 'groenten' }]);
    expect(vegetableScores(getDb()).get(id)).toEqual({ per_serving: 0, unweighed: ['1 pot artisjokharten in olie'] });
    const artichoke = getDb().prepare("SELECT id FROM ingredients WHERE name = 'artisjokharten in olie'").get() as { id: number };
    setConversion(getDb(), artichoke.id, 'g', 1 / 280);
    expect(vegetableScores(getDb()).get(id)).toEqual({ per_serving: 70, unweighed: [] });
  });

  it('can be limited to some recipes', () => {
    const a = recipe('A', [{ name: 'prei', amount: 400, unit: 'g', product_group: 'groenten' }]);
    recipe('B', [{ name: 'prei', amount: 800, unit: 'g', product_group: 'groenten' }]);
    expect([...vegetableScores(getDb(), [a]).keys()]).toEqual([a]);
  });

  it('weighs a proposed ingredient list the way saving would, new ingredients by their group', () => {
    recipe('Bestaand', [{ name: 'Courgettes', amount: 1, unit: 'stuks', product_group: 'groenten' }]);
    const score = vegetableScoreOf(getDb(), [
      { name: 'courgette', amount: 2, unit: 'stuks', product_group: 'overig' }, // known ingredient: its own group
      { name: 'snijbiet', amount: 300, unit: 'g', product_group: 'groenten' }, // new
      { name: 'rode paprika', amount: '2', unit: 'stuks', product_group: 'groenten' },
      { name: 'kikkererwten', amount: 400, unit: 'g', product_group: 'droogwaren' },
    ], 4);
    expect(score).toEqual({ per_serving: Math.round((500 + 300 + 300) / 4), unweighed: [] });
  });
});

describe('labels and score on recipes', () => {
  it('gives each recipe its score, as main course unless marked otherwise', () => {
    const pizza = recipe('Pizza', [{ name: 'snoeptomaatjes', amount: 400, unit: 'g', product_group: 'groenten' }], { veg_exception: true });
    const cake = recipe('Ringtaart', [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }], { main_course: false });

    expect(getRecipe(getDb(), pizza)).toMatchObject({ main_course: true, veg_exception: true, veg_per_serving: 100, veg_unweighed: [] });
    expect(listRecipes(getDb(), {}).find((r) => r.id === cake)).toMatchObject({ main_course: false, veg_exception: false, veg_per_serving: 0 });
  });

  it('keeps the labels when an edit does not mention them', () => {
    const cake = recipe('Ringtaart', [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }], { main_course: false });
    updateRecipe(getDb(), parseRecipeInput({ name: 'Ringtaart', servings: 8, ingredients: [{ name: 'bloem', amount: 300, unit: 'g', product_group: 'droogwaren' }] }), cake);
    expect(getRecipe(getDb(), cake)).toMatchObject({ main_course: false });

    updateRecipe(getDb(), parseRecipeInput({ name: 'Ringtaart', servings: 8, main_course: true, ingredients: [{ name: 'bloem', amount: 300, unit: 'g', product_group: 'droogwaren' }] }), cake);
    expect(getRecipe(getDb(), cake)).toMatchObject({ main_course: true });
  });
});
