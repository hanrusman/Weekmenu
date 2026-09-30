import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-shopping-gen.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { generatePantryCheck, generateShoppingList } = await import('../server/services/shopping-generator');
const { syncRecipeIngredients } = await import('../server/services/ingredients');

type RawIngredient = { name: string; amount: string | number; unit: string; product_group: string };

function createRecipe(name: string, ingredients: RawIngredient[], servings = 4): number {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO recipes (name, source, recipe_data) VALUES (?, 'test', ?)"
  ).run(name, JSON.stringify({ ingredients, steps: [] }));
  const recipeId = result.lastInsertRowid as number;
  syncRecipeIngredients(db, recipeId, ingredients, servings);
  return recipeId;
}

function createMenu(week: number): number {
  const db = getDb();
  return db.prepare('INSERT INTO menus (week_number, year) VALUES (?, 2026)').run(week).lastInsertRowid as number;
}

function addDay(menuId: number, dayName: string, recipeId: number | null, opts: { status?: string; dayOfWeek?: number; recipeData?: string } = {}): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status, recipe_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(menuId, opts.dayOfWeek ?? 0, dayName, `Recept ${dayName}`, opts.recipeData ?? '{}', 'pasta', opts.status ?? 'approved', recipeId);
}

describe('Shopping Generator (structured)', () => {
  beforeAll(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM pantry_check; DELETE FROM shopping_items; DELETE FROM menu_days; DELETE FROM menus; DELETE FROM recipe_ingredients; DELETE FROM ingredients; DELETE FROM recipes;');
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* ok */ }
  });

  describe('generateShoppingList', () => {
    it('builds the list from structured recipe ingredients', () => {
      const menuId = createMenu(20);
      const recipeId = createRecipe('Pasta', [
        { name: 'pasta', amount: 400, unit: 'g', product_group: 'droogwaren' },
        { name: 'courgette', amount: 2, unit: 'stuks', product_group: 'groenten' },
      ]);
      addDay(menuId, 'Woensdag', recipeId);

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ? ORDER BY item_name').all(menuId) as Array<{
        item_name: string; quantity: string; product_group: string; is_perishable: number; for_days: string;
      }>;

      expect(items.map((i) => i.item_name)).toEqual(['courgette', 'pasta']);
      const pasta = items.find((i) => i.item_name === 'pasta')!;
      expect(pasta.quantity).toBe('400 g');
      expect(pasta.is_perishable).toBe(0);
      const courgette = items.find((i) => i.item_name === 'courgette')!;
      expect(courgette.quantity).toBe('2 stuks');
      expect(courgette.is_perishable).toBe(1);
      expect(JSON.parse(courgette.for_days)).toEqual(['Woensdag']);
    });

    it('aggregates the same ingredient across days', () => {
      const menuId = createMenu(21);
      const r1 = createRecipe('A', [{ name: 'gehakt', amount: 200, unit: 'g', product_group: 'vlees' }]);
      const r2 = createRecipe('B', [{ name: 'gehakt', amount: 300, unit: 'g', product_group: 'vlees' }]);
      addDay(menuId, 'Donderdag', r1, { dayOfWeek: 0 });
      addDay(menuId, 'Vrijdag', r2, { dayOfWeek: 1 });

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string; for_days: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe('500 g');
      expect(JSON.parse(items[0].for_days)).toEqual(['Donderdag', 'Vrijdag']);
    });

    it('aggregates synonyms and converted units together', () => {
      const menuId = createMenu(22);
      const r1 = createRecipe('A', [{ name: 'uien', amount: 2, unit: 'stuks', product_group: 'groenten' }]);
      const r2 = createRecipe('B', [{ name: 'Ui', amount: 1, unit: 'stuk', product_group: 'groenten' }]);
      addDay(menuId, 'Donderdag', r1, { dayOfWeek: 0 });
      addDay(menuId, 'Vrijdag', r2, { dayOfWeek: 1 });

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].item_name).toBe('ui');
      expect(items[0].quantity).toBe('3 stuks');
    });

    it('scales amounts by recipe servings to household portions', () => {
      const menuId = createMenu(23);
      // Recipe for 2 persons; household is 4 -> double
      const recipeId = createRecipe('Voor twee', [{ name: 'zalm', amount: 200, unit: 'g', product_group: 'vis' }], 2);
      addDay(menuId, 'Zaterdag', recipeId);

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ quantity: string }>;
      expect(items[0].quantity).toBe('400 g');
    });

    it('adds up spoons and millilitres, which convert the same for every ingredient', () => {
      const menuId = createMenu(24);
      const r1 = createRecipe('A', [{ name: 'olijfolie', amount: 2, unit: 'el', product_group: 'olie' }]);
      const r2 = createRecipe('B', [{ name: 'olijfolie', amount: 45, unit: 'ml', product_group: 'olie' }]);
      const r3 = createRecipe('C', [{ name: 'olijfolie', amount: 3, unit: 'tl', product_group: 'olie' }]);
      addDay(menuId, 'Donderdag', r1, { dayOfWeek: 0 });
      addDay(menuId, 'Vrijdag', r2, { dayOfWeek: 1 });
      addDay(menuId, 'Zaterdag', r3, { dayOfWeek: 2 });

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ quantity: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toBe('6 el'); // 2 el + 45 ml (3 el) + 3 tl (1 el)
    });

    it('keeps units without a known conversion side by side instead of guessing', () => {
      const menuId = createMenu(25);
      const r1 = createRecipe('A', [{ name: 'aubergine', amount: 2, unit: 'stuks', product_group: 'groenten' }]);
      const r2 = createRecipe('B', [{ name: 'aubergine', amount: 300, unit: 'g', product_group: 'groenten' }]);
      addDay(menuId, 'Donderdag', r1, { dayOfWeek: 0 });
      addDay(menuId, 'Vrijdag', r2, { dayOfWeek: 1 });

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ quantity: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].quantity).toContain('2 stuks');
      expect(items[0].quantity).toContain('300 g');
    });

    it('excludes completed days', () => {
      const menuId = createMenu(25);
      const r1 = createRecipe('A', [{ name: 'rijst', amount: 300, unit: 'g', product_group: 'droogwaren' }]);
      const r2 = createRecipe('B', [{ name: 'pasta', amount: 400, unit: 'g', product_group: 'droogwaren' }]);
      addDay(menuId, 'Donderdag', r1, { status: 'completed', dayOfWeek: 0 });
      addDay(menuId, 'Vrijdag', r2, { dayOfWeek: 1 });

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string }>;
      expect(items.map((i) => i.item_name)).toEqual(['pasta']);
    });

    it('preserves checked state on regeneration, matched by name', () => {
      const menuId = createMenu(26);
      const recipeId = createRecipe('Pasta', [
        { name: 'pasta', amount: 400, unit: 'g', product_group: 'droogwaren' },
        { name: 'courgette', amount: 2, unit: 'stuks', product_group: 'groenten' },
      ]);
      addDay(menuId, 'Woensdag', recipeId);

      generateShoppingList(menuId);
      const db = getDb();
      db.prepare("UPDATE shopping_items SET checked = 1 WHERE menu_id = ? AND item_name = 'pasta'").run(menuId);

      generateShoppingList(menuId);

      const items = db.prepare('SELECT item_name, checked FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; checked: number }>;
      expect(items.find((i) => i.item_name === 'pasta')?.checked).toBe(1);
      expect(items.find((i) => i.item_name === 'courgette')?.checked).toBe(0);
    });

    it('falls back to the recipe_data snapshot for days without recipe link', () => {
      const menuId = createMenu(27);
      const recipeData = JSON.stringify({
        ingredients: [{ name: 'tomaten', amount: '500', unit: 'g', product_group: 'groenten' }],
        steps: [],
      });
      addDay(menuId, 'Maandag', null, { recipeData });

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string }>;
      expect(items).toHaveLength(1);
      expect(items[0].item_name).toBe('tomaat');
      expect(items[0].quantity).toBe('500 g');
    });

    it('lists unparseable amounts as their raw text', () => {
      const menuId = createMenu(28);
      const recipeId = createRecipe('Soep', [
        { name: 'peper', amount: 'naar smaak', unit: '', product_group: 'kruiden' },
      ]);
      addDay(menuId, 'Dinsdag', recipeId);

      generateShoppingList(menuId);

      const items = getDb().prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string }>;
      expect(items[0].item_name).toBe('peper');
      expect(items[0].quantity).toBe('naar smaak');
    });
  });

  describe('generatePantryCheck', () => {
    it('generates pantry items for staple groups only', () => {
      const menuId = createMenu(30);
      const recipeId = createRecipe('Pasta', [
        { name: 'olijfolie', amount: 2, unit: 'el', product_group: 'olie' },
        { name: 'pasta', amount: 400, unit: 'g', product_group: 'droogwaren' },
        { name: 'courgette', amount: 2, unit: 'stuks', product_group: 'groenten' },
      ]);
      addDay(menuId, 'Woensdag', recipeId);

      generatePantryCheck(menuId);

      const pantryItems = getDb().prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string }>;
      const names = pantryItems.map((p) => p.item_name);

      expect(names).toContain('olijfolie');
      expect(names).toContain('pasta');
      expect(names).not.toContain('courgette');

      expect(pantryItems.find((p) => p.item_name === 'olijfolie')?.quantity).toBe('2 el');
      expect(pantryItems.find((p) => p.item_name === 'pasta')?.quantity).toBe('400 g');
    });

    it('skips completed days', () => {
      const menuId = createMenu(31);
      const recipeId = createRecipe('Rijst', [{ name: 'rijst', amount: 300, unit: 'g', product_group: 'droogwaren' }]);
      addDay(menuId, 'Woensdag', recipeId, { status: 'completed' });

      generatePantryCheck(menuId);

      expect(getDb().prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId)).toHaveLength(0);
    });

    it('handles malformed legacy recipe data gracefully', () => {
      const menuId = createMenu(32);
      addDay(menuId, 'Woensdag', null, { recipeData: 'not valid json' });

      expect(() => generatePantryCheck(menuId)).not.toThrow();
      expect(getDb().prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId)).toHaveLength(0);
    });

    it('aggregates pantry items across multiple days', () => {
      const menuId = createMenu(33);
      const r1 = createRecipe('A', [{ name: 'olijfolie', amount: 2, unit: 'el', product_group: 'olie' }]);
      const r2 = createRecipe('B', [
        { name: 'olijfolie', amount: 1, unit: 'el', product_group: 'olie' },
        { name: 'sojasaus', amount: 2, unit: 'el', product_group: 'sauzen' },
      ]);
      addDay(menuId, 'Woensdag', r1, { dayOfWeek: 0 });
      addDay(menuId, 'Donderdag', r2, { dayOfWeek: 1 });

      generatePantryCheck(menuId);

      const pantryItems = getDb().prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string; needed_for_days: string }>;
      const olijfolie = pantryItems.find((p) => p.item_name === 'olijfolie');
      expect(olijfolie).toBeDefined();
      expect(olijfolie!.quantity).toBe('3 el');
      const days = JSON.parse(olijfolie!.needed_for_days) as string[];
      expect(days).toContain('Woensdag');
      expect(days).toContain('Donderdag');
    });

    it('clears existing pantry items before regenerating', () => {
      const menuId = createMenu(34);
      getDb().prepare("INSERT INTO pantry_check (menu_id, item_name, needed_for_days) VALUES (?, 'old item', '[]')").run(menuId);

      generatePantryCheck(menuId);

      expect(getDb().prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId)).toHaveLength(0);
    });

    it('preserves have_it state on regeneration, matched by name', () => {
      const menuId = createMenu(35);
      const recipeId = createRecipe('Pasta', [{ name: 'pasta', amount: 400, unit: 'g', product_group: 'droogwaren' }]);
      addDay(menuId, 'Woensdag', recipeId);

      generatePantryCheck(menuId);
      const db = getDb();
      db.prepare("UPDATE pantry_check SET have_it = 1 WHERE menu_id = ? AND item_name = 'pasta'").run(menuId);

      generatePantryCheck(menuId);

      const item = db.prepare("SELECT have_it FROM pantry_check WHERE menu_id = ? AND item_name = 'pasta'").get(menuId) as { have_it: number };
      expect(item.have_it).toBe(1);
    });
  });
});
