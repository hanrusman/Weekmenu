import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-ingredient-admin.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb, cleanupIngredients } = await import('../server/db');
const { syncRecipeIngredients, SEED_ALIASES } = await import('../server/services/ingredients');
const { generateShoppingList } = await import('../server/services/shopping-generator');
const {
  listIngredients, mergeIngredients, renameIngredient, changeIngredientUnit,
  setConversion, looksLikeSameIngredient, IngredientError,
} = await import('../server/services/ingredient-admin');

type RawIngredient = { name: string; amount: string | number; unit: string; product_group: string };

function createRecipe(name: string, ingredients: RawIngredient[]): number {
  const db = getDb();
  const id = db.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES (?, 'test', ?)")
    .run(name, JSON.stringify({ ingredients, steps: [] })).lastInsertRowid as number;
  syncRecipeIngredients(db, id, ingredients, 4);
  return id;
}

function ingredientId(name: string): number {
  return (getDb().prepare('SELECT id FROM ingredients WHERE name = ?').get(name) as { id: number }).id;
}

let week = 0;

function shoppingFor(recipeIds: number[]): Array<{ item_name: string; quantity: string }> {
  const db = getDb();
  const menuId = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (?, 2026, 'active')").run(++week).lastInsertRowid as number;
  recipeIds.forEach((rid, i) => {
    db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, recipe_id) VALUES (?, ?, 'Dag', 'x', '{}', ?)")
      .run(menuId, i, rid);
  });
  generateShoppingList(menuId);
  return db.prepare('SELECT item_name, quantity FROM shopping_items WHERE menu_id = ? ORDER BY item_name').all(menuId) as Array<{ item_name: string; quantity: string }>;
}

describe('Ingredient administration', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    getDb().exec(`
      DELETE FROM menus; DELETE FROM recipes; DELETE FROM recipe_ingredients;
      DELETE FROM ingredient_conversions; DELETE FROM ingredients; DELETE FROM ingredient_aliases;
    `);
    const seed = getDb().prepare('INSERT INTO ingredient_aliases (alias, canonical) VALUES (?, ?)');
    for (const [alias, canonical] of Object.entries(SEED_ALIASES)) seed.run(alias, canonical);
  });

  it('adds up different units once a conversion is known', () => {
    const a = createRecipe('Curry', [{ name: 'kikkererwten', amount: 1, unit: 'blik', product_group: 'droogwaren' }]);
    const b = createRecipe('Salade', [{ name: 'kikkererwten', amount: 240, unit: 'g', product_group: 'droogwaren' }]);

    expect(shoppingFor([a, b])[0].quantity).toBe('1 blik, 240 g');
    expect(listIngredients(getDb()).find((i) => i.name === 'kikkererwten')?.needs_attention).toBe(true);

    setConversion(getDb(), ingredientId('kikkererwten'), 'g', 1 / 400);
    expect(shoppingFor([a, b])[0].quantity).toBe('2 blik'); // 1.6 blik rounded up
    expect(listIngredients(getDb()).find((i) => i.name === 'kikkererwten')?.needs_attention).toBe(false);
  });

  it('learns a conversion from an "à 400g" hint when the base unit is grams', () => {
    createRecipe('Soep', [{ name: 'tomatenblokjes', amount: 200, unit: 'g', product_group: 'sauzen' }]);
    const r = createRecipe('Stoof', [{ name: 'tomatenblokjes', amount: 2, unit: 'blikken (à 400g)', product_group: 'sauzen' }]);
    const conv = getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(ingredientId('tomatenblokjes'));
    expect(conv).toEqual([{ unit: 'blik', factor: 400 }]);
    expect(shoppingFor([r])[0].quantity).toBe('800 g');
  });

  it('merges ingredients, moves conversions and keeps the old name as alias', () => {
    const r = createRecipe('Stamppot', [
      { name: 'winterpeen', amount: 500, unit: 'g', product_group: 'groenten' },
      { name: 'bospeen', amount: 2, unit: 'stuks', product_group: 'groenten' },
    ]);
    const bospeen = ingredientId('bospeen');
    setConversion(getDb(), bospeen, 'g', 1 / 100);

    // winterpeen is seeded as alias for wortel
    const recipeIds = mergeIngredients(getDb(), ingredientId('wortel'), bospeen);
    expect(recipeIds).toEqual([r]);
    expect(shoppingFor([r])).toEqual([{ item_name: 'bospeen', quantity: '7 stuks' }]);

    // Re-importing the old name now lands on the merged ingredient
    createRecipe('Nieuw', [{ name: 'wortel', amount: 1, unit: 'stuks', product_group: 'groenten' }]);
    expect(getDb().prepare("SELECT COUNT(*) AS c FROM ingredients WHERE name = 'wortel'").get()).toEqual({ c: 0 });
    // ...and so does an alias that used to point to the old name
    createRecipe('Nieuwer', [{ name: 'winterpeen', amount: 1, unit: 'stuks', product_group: 'groenten' }]);
    expect(getDb().prepare("SELECT COUNT(*) AS c FROM ingredients WHERE name IN ('wortel', 'winterpeen')").get()).toEqual({ c: 0 });
  });

  it('refuses to rename onto an existing name and reports the conflict', () => {
    createRecipe('R', [
      { name: 'boter', amount: 20, unit: 'g', product_group: 'zuivel' },
      { name: 'roomboter', amount: 20, unit: 'g', product_group: 'zuivel' },
    ]);
    try {
      renameIngredient(getDb(), ingredientId('boter'), 'Roomboter');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IngredientError);
      expect((err as InstanceType<typeof IngredientError>).conflictId).toBe(ingredientId('roomboter'));
    }
  });

  it('rename leaves an alias so re-syncing the recipe keeps the new name', () => {
    const r = createRecipe('R', [{ name: 'Kastanjechampignons', amount: 250, unit: 'g', product_group: 'groenten' }]);
    renameIngredient(getDb(), ingredientId('kastanjechampignons'), 'champignon');
    syncRecipeIngredients(getDb(), r, [{ name: 'Kastanjechampignons', amount: 250, unit: 'g', product_group: 'groenten' }], 4);
    expect(shoppingFor([r])).toEqual([{ item_name: 'champignon', quantity: '250 g' }]);
  });

  it('rebases conversions when the unit of an ingredient changes', () => {
    createRecipe('R', [{ name: 'kikkererwten', amount: 400, unit: 'g', product_group: 'droogwaren' }]);
    const id = ingredientId('kikkererwten');
    setConversion(getDb(), id, 'blik', 400);
    setConversion(getDb(), id, 'pot', 600);

    expect(changeIngredientUnit(getDb(), id, 'blik')).toBe(false);
    const conv = Object.fromEntries((getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(id) as Array<{ unit: string; factor: number }>).map((c) => [c.unit, c.factor]));
    expect(conv).toEqual({ g: 1 / 400, pot: 1.5 });
  });

  it('drops conversions when the new unit cannot be related to the old one', () => {
    createRecipe('R', [{ name: 'kikkererwten', amount: 400, unit: 'g', product_group: 'droogwaren' }]);
    const id = ingredientId('kikkererwten');
    setConversion(getDb(), id, 'blik', 400);
    expect(changeIngredientUnit(getDb(), id, 'pot')).toBe(true);
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM ingredient_conversions WHERE ingredient_id = ?').get(id)).toEqual({ c: 0 });
  });

  it('lets a specific product group replace the overig fallback', () => {
    createRecipe('A', [{ name: 'passata', amount: 500, unit: 'g', product_group: '' }]);
    createRecipe('B', [{ name: 'passata', amount: 500, unit: 'g', product_group: 'sauzen' }]);
    createRecipe('C', [{ name: 'passata', amount: 500, unit: 'g', product_group: 'droogwaren' }]);
    expect(getDb().prepare("SELECT product_group FROM ingredients WHERE name = 'passata'").get()).toEqual({ product_group: 'sauzen' });
  });

  it('suggests likely duplicates', () => {
    expect(looksLikeSameIngredient('winterwortel', 'wortel')).toBe(true);
    expect(looksLikeSameIngredient('courgete', 'courgette')).toBe(true);
    expect(looksLikeSameIngredient('rode ui', 'ui')).toBe(false);
    expect(looksLikeSameIngredient('ui', 'ei')).toBe(false);
  });

  it('cleanup merges annotated duplicates and picks the most used unit', () => {
    const db = getDb();
    const insert = db.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES (?, 'weekmenu', ?)");
    insert.run('Oud 1', JSON.stringify({ ingredients: [{ name: 'kikkererwten (blik)', amount: 1, unit: 'blik', product_group: 'droogwaren' }] }));
    insert.run('Oud 2', JSON.stringify({ ingredients: [{ name: 'kikkererwten uit blik', amount: 2, unit: 'blikken', product_group: 'droogwaren' }] }));
    insert.run('Oud 3', JSON.stringify({ ingredients: [{ name: 'kikkererwten (blik, uitgelekt)', amount: 240, unit: 'g', product_group: 'droogwaren' }] }));
    // A stale ingredient left over from the old normalization
    db.prepare("INSERT INTO ingredients (name, unit) VALUES ('kikkererwten (blik)', 'blik')").run();

    cleanupIngredients(db);

    const rows = db.prepare("SELECT name, unit FROM ingredients WHERE name LIKE 'kikkererwten%'").all();
    expect(rows).toEqual([{ name: 'kikkererwten', unit: 'blik' }]);
  });
});
