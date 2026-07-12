import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-compose.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { composeMenu } = await import('../server/services/menu-generator');
const { syncRecipeIngredients } = await import('../server/services/ingredients');

const PASTA_RECIPE = {
  servings: 4,
  ingredients: [
    { name: 'pasta', amount: '400', unit: 'g', product_group: 'droogwaren' },
    { name: 'pesto', amount: '100', unit: 'g', product_group: 'sauzen' },
  ],
  steps: ['Kook de pasta', 'Meng met pesto'],
  nutrition_per_serving: { calories: 450, protein_g: 18, fiber_g: 6, iron_mg: 2.5 },
};

const NASI_RECIPE = {
  servings: 4,
  ingredients: [
    { name: 'rijst', amount: '300', unit: 'g', product_group: 'droogwaren' },
  ],
  steps: ['Kook de rijst', 'Bak de groenten'],
  nutrition_per_serving: { calories: 500, protein_g: 22, fiber_g: 5, iron_mg: 3.0 },
};

function seedRecipe(name: string, recipe: typeof PASTA_RECIPE, tags: string[], prepTime: number | null = 20, costIndex: string | null = '€'): number {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO recipes (name, source, recipe_data, tags, times_used, prep_time_minutes, cost_index) VALUES (?, 'manual', ?, ?, 0, ?, ?)"
  ).run(name, JSON.stringify(recipe), JSON.stringify(tags), prepTime, costIndex);
  const id = result.lastInsertRowid as number;
  syncRecipeIngredients(db, id, recipe.ingredients, recipe.servings);
  return id;
}

describe('composeMenu', () => {
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
    db.exec('DELETE FROM day_feedback; DELETE FROM pantry_check; DELETE FROM menu_days; DELETE FROM shopping_items; DELETE FROM menus; DELETE FROM recipe_ingredients; DELETE FROM ingredients; DELETE FROM recipes;');
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* ok */ }
  });

  it('should create an active menu with correct Thu-Wed dates', () => {
    const pastaId = seedRecipe('Pasta pesto', PASTA_RECIPE, ['pasta']);
    const nasiId = seedRecipe('Nasi goreng', NASI_RECIPE, ['rijst']);

    const menuId = composeMenu({
      days: [
        { day_name: 'Donderdag', recipe_id: pastaId },
        { day_name: 'Vrijdag', recipe_id: nasiId },
        { day_name: 'Maandag', recipe_id: pastaId },
      ],
    }, 14, 2026);

    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId) as { week_number: number; year: number; status: string };
    expect(menu.week_number).toBe(14);
    expect(menu.status).toBe('active');

    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(menuId) as Array<{
      date: string; day_name: string; recipe_name: string; recipe_id: number; status: string; meal_type: string; prep_time_minutes: number; cost_index: string;
    }>;
    expect(days).toHaveLength(3);
    // Week 14, 2026: Donderdag = 2026-04-02, Maandag rolls to next week
    expect(days[0].date).toBe('2026-04-02');
    expect(days[1].date).toBe('2026-04-03');
    expect(days[2].date).toBe('2026-04-06');
    expect(days[0].recipe_name).toBe('Pasta pesto');
    expect(days[0].recipe_id).toBe(pastaId);
    expect(days[0].status).toBe('approved');
    expect(days[0].meal_type).toBe('pasta');
    expect(days[0].prep_time_minutes).toBe(20);
    expect(days[0].cost_index).toBe('€');
  });

  it('should fall back to defaults for missing meal_type, prep time and cost', () => {
    const id = seedRecipe('Kaal recept', NASI_RECIPE, [], null, null);
    const menuId = composeMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }] }, 14, 2026);

    const db = getDb();
    const day = db.prepare('SELECT meal_type, prep_time_minutes, cost_index FROM menu_days WHERE menu_id = ?').get(menuId) as {
      meal_type: string; prep_time_minutes: number; cost_index: string;
    };
    expect(day.meal_type).toBe('overig');
    expect(day.prep_time_minutes).toBe(30);
    expect(day.cost_index).toBe('€€');
  });

  it('should bump times_used and last_used', () => {
    const id = seedRecipe('Pasta pesto', PASTA_RECIPE, ['pasta']);
    composeMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }] }, 14, 2026);

    const db = getDb();
    const recipe = db.prepare('SELECT times_used, last_used FROM recipes WHERE id = ?').get(id) as { times_used: number; last_used: string };
    expect(recipe.times_used).toBe(1);
    expect(recipe.last_used).not.toBeNull();
  });

  it('should replace an existing menu for the same week', () => {
    const id = seedRecipe('Pasta pesto', PASTA_RECIPE, ['pasta']);
    const id1 = composeMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }] }, 14, 2026);
    const id2 = composeMenu({ days: [{ day_name: 'Vrijdag', recipe_id: id }] }, 14, 2026);
    expect(id2).not.toBe(id1);

    const db = getDb();
    expect(db.prepare('SELECT * FROM menus WHERE id = ?').get(id1)).toBeUndefined();
  });

  it('should generate a shopping list from the recipe ingredients', () => {
    const id = seedRecipe('Pasta pesto', PASTA_RECIPE, ['pasta']);
    const menuId = composeMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }] }, 14, 2026);

    const db = getDb();
    const items = db.prepare('SELECT item_name, quantity FROM shopping_items WHERE menu_id = ? ORDER BY item_name').all(menuId) as Array<{ item_name: string; quantity: string }>;
    expect(items.map((i) => i.item_name)).toEqual(['pasta', 'pesto']);
    expect(items[0].quantity).toBe('400 g');
  });

  it('should roll back the whole menu when a recipe id is unknown', () => {
    const id = seedRecipe('Pasta pesto', PASTA_RECIPE, ['pasta']);
    expect(() => composeMenu({
      days: [
        { day_name: 'Donderdag', recipe_id: id },
        { day_name: 'Vrijdag', recipe_id: 99999 },
      ],
    }, 14, 2026)).toThrow('Recept niet gevonden');

    const db = getDb();
    const menus = db.prepare('SELECT COUNT(*) as c FROM menus').get() as { c: number };
    expect(menus.c).toBe(0);
  });

  it('should reject duplicate day names', () => {
    const id = seedRecipe('Pasta pesto', PASTA_RECIPE, ['pasta']);
    expect(() => composeMenu({
      days: [
        { day_name: 'Donderdag', recipe_id: id },
        { day_name: 'Donderdag', recipe_id: id },
      ],
    }, 14, 2026)).toThrow('Elke dag mag maar één keer voorkomen');
  });

  it('should reject invalid day names and empty days', () => {
    expect(() => composeMenu({ days: [{ day_name: 'Zomaardag', recipe_id: 1 }] }, 14, 2026)).toThrow();
    expect(() => composeMenu({ days: [] }, 14, 2026)).toThrow();
  });
});
