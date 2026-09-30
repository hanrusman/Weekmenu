import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-ingredient-admin.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb, cleanupIngredients, removeUniversalConversions, migrateStructuredIngredients } = await import('../server/db');
const { syncRecipeIngredients, SEED_ALIASES } = await import('../server/services/ingredients');
const { generateShoppingList, generatePantryCheck } = await import('../server/services/shopping-generator');
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
    const a = createRecipe('Pasta', [{ name: 'arrabbiata saus', amount: 1, unit: 'pot', product_group: 'sauzen' }]);
    const b = createRecipe('Ovenschotel', [{ name: 'arrabbiata saus', amount: 240, unit: 'g', product_group: 'sauzen' }]);

    expect(shoppingFor([a, b])[0].quantity).toBe('1 pot, 240 g');
    expect(listIngredients(getDb()).find((i) => i.name === 'arrabbiata saus')?.needs_attention).toBe(true);

    setConversion(getDb(), ingredientId('arrabbiata saus'), 'g', 1 / 400);
    expect(shoppingFor([a, b])[0].quantity).toBe('2 pot'); // 1.6 pot rounded up
    expect(listIngredients(getDb()).find((i) => i.name === 'arrabbiata saus')?.needs_attention).toBe(false);
  });

  it('adds up tins and grams without a conversion, a tin being 400 g', () => {
    const a = createRecipe('Curry', [{ name: 'kikkererwten', amount: 1, unit: 'blik', product_group: 'droogwaren' }]);
    const b = createRecipe('Salade', [{ name: 'kikkererwten', amount: 240, unit: 'g', product_group: 'droogwaren' }]);
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

  it('carries conversions across a merge when the units relate universally', () => {
    const r = createRecipe('R', [
      { name: 'koolzaadolie', amount: 3, unit: 'tl', product_group: 'olie' },
      { name: 'raapzaadolie', amount: 1, unit: 'el', product_group: 'olie' },
    ]);
    setConversion(getDb(), ingredientId('koolzaadolie'), 'fles', 150); // 1 fles = 150 tl

    mergeIngredients(getDb(), ingredientId('koolzaadolie'), ingredientId('raapzaadolie'));

    const target = ingredientId('raapzaadolie');
    expect(getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(target))
      .toEqual([{ unit: 'fles', factor: 50 }]);
    expect(shoppingFor([r])).toEqual([{ item_name: 'raapzaadolie', quantity: '2 el' }]);
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
    setConversion(getDb(), id, 'blik', 425); // a bigger tin than the standard 400 g
    setConversion(getDb(), id, 'pot', 600);

    expect(changeIngredientUnit(getDb(), id, 'blik')).toBe(false);
    const conv = Object.fromEntries((getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(id) as Array<{ unit: string; factor: number }>).map((c) => [c.unit, c.factor]));
    expect(conv).toEqual({ g: 1 / 425, pot: 600 / 425 });
  });

  it('rebases conversions through a universal spoon conversion', () => {
    createRecipe('R', [
      { name: 'olijfolie', amount: 2, unit: 'el', product_group: 'olie' },
      { name: 'olijfolie', amount: 1, unit: 'tl', product_group: 'olie' },
    ]);
    const id = ingredientId('olijfolie');
    setConversion(getDb(), id, 'fles', 50); // 1 fles = 50 el

    expect(changeIngredientUnit(getDb(), id, 'tl')).toBe(false);
    const conv = Object.fromEntries((getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(id) as Array<{ unit: string; factor: number }>).map((c) => [c.unit, c.factor]));
    expect(conv).toEqual({ fles: 150 }); // el ↔ tl holds anyway, so it is not stored
  });

  describe('a wrong legacy spoon conversion in the database', () => {
    // Stored before el/tl/ml became universal: 1 tl = 0,5 el (really 1/3)
    function withLegacy() {
      const r = createRecipe('R', [
        { name: 'olijfolie', amount: 2, unit: 'el', product_group: 'olie' },
        { name: 'olijfolie', amount: 3, unit: 'tl', product_group: 'olie' },
      ]);
      const id = ingredientId('olijfolie');
      getDb().prepare("INSERT INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, 'tl', 0.5)").run(id);
      getDb().prepare("INSERT INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, 'fles', 50)").run(id);
      return { r, id };
    }

    it('does not change the shopping list total', () => {
      const { r } = withLegacy();
      expect(shoppingFor([r])).toEqual([{ item_name: 'olijfolie', quantity: '3 el' }]); // 2 el + 3 tl, not 3.5 el
    });

    it('does not show up as the ingredient\'s conversion', () => {
      withLegacy();
      const olie = listIngredients(getDb()).find((i) => i.name === 'olijfolie')!;
      expect(olie.units_used).toContainEqual({ unit: 'tl', count: 1, factor: 1 / 3, builtin: true });
    });

    it('does not skew a unit change', () => {
      const { id } = withLegacy();
      changeIngredientUnit(getDb(), id, 'tl');
      expect(getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(id))
        .toEqual([{ unit: 'fles', factor: 150 }]);
    });

    it('does not skew a merge', () => {
      const { id } = withLegacy();
      createRecipe('S', [{ name: 'raapzaadolie', amount: 100, unit: 'ml', product_group: 'olie' }]);
      mergeIngredients(getDb(), id, ingredientId('raapzaadolie'));
      expect(getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(ingredientId('raapzaadolie')))
        .toEqual([{ unit: 'fles', factor: 750 }]); // 50 el = 750 ml
    });

    it('is removed by the v4 cleanup, which keeps other conversions', () => {
      const { id } = withLegacy();
      removeUniversalConversions(getDb());
      expect(getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(id))
        .toEqual([{ unit: 'fles', factor: 50 }]);
    });
  });

  describe('typical piece weights', () => {
    it('count tins as 400 g, so tins and grams of one ingredient add up', () => {
      createRecipe('A', [
        { name: 'tomatenblokjes uit blik', amount: 1, unit: 'blik', product_group: 'conserven' },
        { name: 'tomatenblokjes uit blik', amount: 200, unit: 'g', product_group: 'conserven' },
      ]);
      const tomatoes = listIngredients(getDb()).find((i) => i.name === 'tomatenblokjes uit blik')!;
      expect(tomatoes.needs_attention).toBe(false);
      expect(tomatoes.units_used).toContainEqual({ unit: 'g', count: 1, factor: 1 / 400, standard: true });
    });

    it('let a tin size learned from the recipe ("à 425 g") win over the standard', () => {
      createRecipe('A', [
        { name: 'kikkererwten uit blik', amount: 2, unit: 'blikken (à 425g)', product_group: 'conserven' },
        { name: 'kikkererwten uit blik', amount: 200, unit: 'g', product_group: 'conserven' },
      ]);
      const chickpeas = listIngredients(getDb()).find((i) => i.name === 'kikkererwten uit blik')!;
      const other = chickpeas.units_used.find((u) => u.unit !== chickpeas.unit)!;
      expect(other.standard).toBeUndefined();
      expect(other.factor).toBeCloseTo(chickpeas.unit === 'blik' ? 1 / 425 : 425);
    });

    it('show as a standard conversion and keep the ingredient out of "telt niet op"', () => {
      createRecipe('A', [
        { name: 'courgette', amount: 2, unit: 'stuks', product_group: 'groenten' },
        { name: 'courgette', amount: 250, unit: 'g', product_group: 'groenten' },
      ]);
      const courgette = listIngredients(getDb()).find((i) => i.name === 'courgette')!;
      expect(courgette.needs_attention).toBe(false);
      expect(courgette.units_used).toContainEqual({ unit: 'g', count: 1, factor: 1 / 250, standard: true });
    });

    it('give way to a conversion set by hand', () => {
      const r = createRecipe('A', [
        { name: 'aubergine', amount: 2, unit: 'stuks', product_group: 'groenten' },
        { name: 'aubergine', amount: 450, unit: 'g', product_group: 'groenten' },
      ]);
      setConversion(getDb(), ingredientId('aubergine'), 'g', 1 / 450); // our aubergines weigh 450 g
      expect(shoppingFor([r])).toEqual([{ item_name: 'aubergine', quantity: '3 stuks' }]);
      expect(listIngredients(getDb()).find((i) => i.name === 'aubergine')!.units_used)
        .toContainEqual({ unit: 'g', count: 1, factor: 1 / 450 });
    });

    it('survive a rename of the ingredient', () => {
      const r = createRecipe('A', [
        { name: 'tomaat', amount: 2, unit: 'stuks', product_group: 'groenten' },
        { name: 'tomaat', amount: 200, unit: 'g', product_group: 'groenten' },
      ]);
      renameIngredient(getDb(), ingredientId('tomaat'), 'tomaten');
      expect(shoppingFor([r])).toEqual([{ item_name: 'tomaten', quantity: '4 stuks' }]);
      expect(listIngredients(getDb()).find((i) => i.name === 'tomaten')!.needs_attention).toBe(false);
    });

    it('follow the variety as written, not the ingredient it is an alias of', () => {
      const r = createRecipe('A', [
        { name: 'wortel', amount: 300, unit: 'g', product_group: 'groenten' },
        { name: 'winterpeen', amount: 2, unit: 'stuks', product_group: 'groenten' },
      ]);
      // winterpeen is an alias of wortel, but weighs 200 g rather than 100 g
      expect(shoppingFor([r])).toEqual([{ item_name: 'wortel', quantity: '700 g' }]);
    });

    it('are kept by re-deriving old rows that lack the name as written', () => {
      const db = getDb();
      const r = createRecipe('A', [{ name: 'winterpeen', amount: 1, unit: 'stuks', product_group: 'groenten' }]);
      db.prepare('UPDATE recipe_ingredients SET source_name = NULL WHERE recipe_id = ?').run(r);
      migrateStructuredIngredients(db);
      expect(db.prepare('SELECT source_name FROM recipe_ingredients WHERE recipe_id = ?').all(r)).toEqual([{ source_name: 'winterpeen' }]);
    });

    it('let a unit change keep other conversions', () => {
      createRecipe('A', [{ name: 'bloemkool', amount: 1, unit: 'stuks', product_group: 'groenten' }]);
      const id = ingredientId('bloemkool');
      setConversion(getDb(), id, 'zak', 0.5); // a bag of florets is half a cauliflower
      expect(changeIngredientUnit(getDb(), id, 'g')).toBe(false);
      // 1 stuks = 800 g is the typical weight anyway, so only the bag is stored
      expect(getDb().prepare('SELECT unit, factor FROM ingredient_conversions WHERE ingredient_id = ?').all(id))
        .toEqual([{ unit: 'zak', factor: 400 }]);
      expect(listIngredients(getDb()).find((i) => i.name === 'bloemkool')!.units_used)
        .toContainEqual({ unit: 'stuks', count: 1, factor: 800, standard: true });
    });
  });

  it('refuses to store a conversion between el, tl and ml', () => {
    createRecipe('R', [{ name: 'olijfolie', amount: 2, unit: 'el', product_group: 'olie' }]);
    expect(() => setConversion(getDb(), ingredientId('olijfolie'), 'tl', 0.5)).toThrow(/rekenen al vast om/);
    expect(() => setConversion(getDb(), ingredientId('olijfolie'), 'ml', 10)).toThrow(IngredientError);
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

  it('treats names that differ only in spaces or hyphens as the same ingredient', () => {
    const a = createRecipe('A', [{ name: 'basmati rijst', amount: 300, unit: 'g', product_group: 'droogwaren' }]);
    const b = createRecipe('B', [{ name: 'basmatirijst', amount: 200, unit: 'g', product_group: 'droogwaren' }]);
    const c = createRecipe('C', [{ name: 'basmati-rijst', amount: 100, unit: 'g', product_group: 'droogwaren' }]);
    expect(getDb().prepare("SELECT name FROM ingredients WHERE name LIKE 'basmati%'").all()).toEqual([{ name: 'basmati rijst' }]);
    expect(shoppingFor([a, b, c])).toEqual([{ item_name: 'basmati rijst', quantity: '600 g' }]);
  });

  it('shows universal spoon conversions as built in, not as missing', () => {
    createRecipe('A', [{ name: 'harissa', amount: 1, unit: 'el', product_group: 'sauzen' }]);
    createRecipe('B', [{ name: 'harissa', amount: 2, unit: 'tl', product_group: 'sauzen' }]);
    const harissa = listIngredients(getDb()).find((i) => i.name === 'harissa')!;
    expect(harissa.needs_attention).toBe(false);
    expect(harissa.units_used).toContainEqual({ unit: 'tl', count: 1, factor: 1 / 3, builtin: true });
  });

  it('suggests likely duplicates', () => {
    expect(looksLikeSameIngredient('winterwortel', 'wortel')).toBe(true);
    expect(looksLikeSameIngredient('kikkererwten', 'kikkererwten uit blik')).toBe(true);
    expect(looksLikeSameIngredient('garnalen', 'diepvries garnalen')).toBe(true);
    expect(looksLikeSameIngredient('courgete', 'courgette')).toBe(true);
    expect(looksLikeSameIngredient('rode ui', 'ui')).toBe(false);
    expect(looksLikeSameIngredient('ui', 'ei')).toBe(false);
  });

  it('cleanup merges packaging variants, picks the most used unit and learns the inverse conversion', () => {
    const db = getDb();
    const insert = db.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES (?, 'weekmenu', ?)");
    const ids = [
      insert.run('Oud 1', JSON.stringify({ ingredients: [{ name: 'kikkererwten (blik)', amount: 1, unit: 'blik', product_group: 'droogwaren' }] })),
      insert.run('Oud 2', JSON.stringify({ ingredients: [{ name: 'kikkererwten uit blik', amount: 2, unit: 'blikken (à 400g)', product_group: 'droogwaren' }] })),
      insert.run('Oud 3', JSON.stringify({ ingredients: [{ name: 'kikkererwten (blik, uitgelekt)', amount: 240, unit: 'g', product_group: 'droogwaren' }] })),
    ].map((r) => r.lastInsertRowid as number);
    // A stale ingredient left over from the old normalization
    db.prepare("INSERT INTO ingredients (name, unit) VALUES ('kikkererwten (blik)', 'blik')").run();

    cleanupIngredients(db);

    const rows = db.prepare("SELECT name, unit FROM ingredients WHERE name LIKE 'kikkererwten%'").all();
    expect(rows).toEqual([{ name: 'kikkererwten uit blik', unit: 'blik' }]);
    // blik won as unit, so "(à 400g)" must be learned as 1 g = 1/400 blik
    expect(db.prepare('SELECT unit, factor FROM ingredient_conversions').all()).toEqual([{ unit: 'g', factor: 1 / 400 }]);
    // 1 + 2 + 240/400 = 3.6 blik
    expect(shoppingFor(ids)).toEqual([{ item_name: 'kikkererwten uit blik', quantity: '4 blik' }]);
  });

  it('refuses to rename onto an alias of another ingredient', () => {
    createRecipe('R', [
      { name: 'wortel', amount: 2, unit: 'stuks', product_group: 'groenten' },
      { name: 'bospeen', amount: 1, unit: 'bos', product_group: 'groenten' },
    ]);
    try {
      renameIngredient(getDb(), ingredientId('bospeen'), 'winterpeen'); // seeded alias of wortel
      expect.unreachable();
    } catch (err) {
      expect((err as InstanceType<typeof IngredientError>).status).toBe(409);
      expect((err as InstanceType<typeof IngredientError>).conflictId).toBe(ingredientId('wortel'));
    }
  });

  it('takes over an alias whose ingredient no longer exists', () => {
    createRecipe('R', [{ name: 'bospeen', amount: 1, unit: 'bos', product_group: 'groenten' }]);
    // winterpeen -> wortel, but there is no wortel ingredient
    renameIngredient(getDb(), ingredientId('bospeen'), 'winterpeen');
    createRecipe('Nieuw', [{ name: 'Winterpeen', amount: 1, unit: 'bos', product_group: 'groenten' }]);
    expect(getDb().prepare("SELECT name FROM ingredients WHERE name IN ('winterpeen', 'wortel')").all()).toEqual([{ name: 'winterpeen' }]);
  });

  describe('ticked-off state across renames and merges', () => {
    function stateOf(menuId: number) {
      const db = getDb();
      return {
        checked: Object.fromEntries((db.prepare('SELECT item_name, checked FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; checked: number }>).map((r) => [r.item_name, r.checked])),
        have: Object.fromEntries((db.prepare('SELECT item_name, have_it FROM pantry_check WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; have_it: number }>).map((r) => [r.item_name, r.have_it])),
      };
    }

    function tick(menuId: number, name: string) {
      getDb().prepare('UPDATE shopping_items SET checked = 1 WHERE menu_id = ? AND item_name = ?').run(menuId, name);
      getDb().prepare('UPDATE pantry_check SET have_it = 1 WHERE menu_id = ? AND item_name = ?').run(menuId, name);
    }

    function regenerate(menuId: number) {
      generateShoppingList(menuId);
      generatePantryCheck(menuId);
    }

    it('keeps an item ticked off after a rename', () => {
      const r = createRecipe('R', [{ name: 'boter', amount: 20, unit: 'g', product_group: 'zuivel' }]);
      shoppingFor([r]);
      const menuId = (getDb().prepare('SELECT MAX(id) AS id FROM menus').get() as { id: number }).id;
      generatePantryCheck(menuId);
      tick(menuId, 'boter');

      renameIngredient(getDb(), ingredientId('boter'), 'roomboter');
      regenerate(menuId);

      expect(stateOf(menuId)).toEqual({ checked: { roomboter: 1 }, have: { roomboter: 1 } });
    });

    it('keeps a merged item ticked off only when all merged items were', () => {
      const r = createRecipe('R', [
        { name: 'boter', amount: 20, unit: 'g', product_group: 'zuivel' },
        { name: 'roomboter', amount: 30, unit: 'g', product_group: 'zuivel' },
        { name: 'margarine', amount: 10, unit: 'g', product_group: 'zuivel' },
        { name: 'halvarine', amount: 10, unit: 'g', product_group: 'zuivel' },
      ]);
      shoppingFor([r]);
      const menuId = (getDb().prepare('SELECT MAX(id) AS id FROM menus').get() as { id: number }).id;
      generatePantryCheck(menuId);
      tick(menuId, 'boter');
      tick(menuId, 'roomboter');
      tick(menuId, 'margarine');

      mergeIngredients(getDb(), ingredientId('boter'), ingredientId('roomboter'));
      mergeIngredients(getDb(), ingredientId('halvarine'), ingredientId('margarine'));
      regenerate(menuId);

      expect(stateOf(menuId)).toEqual({
        checked: { roomboter: 1, margarine: 0 },
        have: { roomboter: 1, margarine: 0 },
      });
    });
  });
});
