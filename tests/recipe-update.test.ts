import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-recipe-update.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { updateRecipe, RecipeError } = await import('../server/services/recipes');

const RECIPE_DATA = {
  servings: 4,
  ingredients: [{ name: 'pasta', amount: '400', unit: 'g', product_group: 'droogwaren' }],
  steps: ['Kook de pasta'],
  nutrition_per_serving: { calories: 450, protein_g: 18, fiber_g: 6, iron_mg: 2.5 },
};

function seedRecipe(name: string): number {
  const db = getDb();
  const result = db.prepare(
    "INSERT INTO recipes (name, source, recipe_data, tags) VALUES (?, 'manual', ?, '[]')"
  ).run(name, JSON.stringify(RECIPE_DATA));
  return result.lastInsertRowid as number;
}

function seedMenuWithDay(recipeId: number, recipeName: string, status: string): { menuId: number; dayId: number } {
  const db = getDb();
  const menu = db.prepare(
    'INSERT INTO menus (week_number, year, status) VALUES (?, 2026, ?)'
  ).run(Math.floor(Math.random() * 1000), status);
  const menuId = menu.lastInsertRowid as number;
  const day = db.prepare(`
    INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, recipe_id)
    VALUES (?, 0, 'Donderdag', ?, ?, ?)
  `).run(menuId, recipeName, JSON.stringify(RECIPE_DATA), recipeId);
  return { menuId, dayId: day.lastInsertRowid as number };
}

describe('updateRecipe', () => {
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

  it('propagates a rename to menu_days.recipe_name in all menus', () => {
    const id = seedRecipe('Pasta pesto');
    seedMenuWithDay(id, 'Pasta pesto', 'active');
    seedMenuWithDay(id, 'Pasta pesto', 'archived');

    updateRecipe(id, { recipe_data: RECIPE_DATA, name: 'Pasta pesto deluxe' });

    const db = getDb();
    const names = db.prepare('SELECT recipe_name FROM menu_days').all() as Array<{ recipe_name: string }>;
    expect(names.every((n) => n.recipe_name === 'Pasta pesto deluxe')).toBe(true);
  });

  it('updates recipe_data snapshots only in active menus', () => {
    const id = seedRecipe('Pasta pesto');
    const active = seedMenuWithDay(id, 'Pasta pesto', 'active');
    const archived = seedMenuWithDay(id, 'Pasta pesto', 'archived');

    const newData = { ...RECIPE_DATA, steps: ['Nieuwe stap'] };
    updateRecipe(id, { recipe_data: newData });

    const db = getDb();
    const activeDay = db.prepare('SELECT recipe_data FROM menu_days WHERE id = ?').get(active.dayId) as { recipe_data: string };
    const archivedDay = db.prepare('SELECT recipe_data FROM menu_days WHERE id = ?').get(archived.dayId) as { recipe_data: string };
    expect(JSON.parse(activeDay.recipe_data).steps).toEqual(['Nieuwe stap']);
    expect(JSON.parse(archivedDay.recipe_data).steps).toEqual(['Kook de pasta']);
  });

  it('rejects a rename to an existing name, case-insensitively', () => {
    seedRecipe('Nasi goreng');
    const id = seedRecipe('Pasta pesto');

    expect(() => updateRecipe(id, { recipe_data: RECIPE_DATA, name: 'nasi GORENG' }))
      .toThrow(RecipeError);
    try {
      updateRecipe(id, { recipe_data: RECIPE_DATA, name: 'nasi GORENG' });
    } catch (err) {
      expect((err as InstanceType<typeof RecipeError>).status).toBe(409);
    }
  });

  it('allows saving under the own unchanged name', () => {
    const id = seedRecipe('Pasta pesto');
    expect(() => updateRecipe(id, { recipe_data: RECIPE_DATA, name: 'Pasta pesto' })).not.toThrow();
  });

  it('throws 404 for an unknown recipe', () => {
    try {
      updateRecipe(999, { recipe_data: RECIPE_DATA });
      expect.unreachable();
    } catch (err) {
      expect((err as InstanceType<typeof RecipeError>).status).toBe(404);
    }
  });

  it('resyncs structured ingredients', () => {
    const id = seedRecipe('Pasta pesto');
    const newData = {
      ...RECIPE_DATA,
      ingredients: [
        { name: 'penne', amount: '500', unit: 'g', product_group: 'droogwaren' },
        { name: 'pesto', amount: '100', unit: 'g', product_group: 'sauzen' },
      ],
    };
    updateRecipe(id, { recipe_data: newData });

    const db = getDb();
    const rows = db.prepare(`
      SELECT i.name FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id
      WHERE ri.recipe_id = ? ORDER BY i.name
    `).all(id) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(['penne', 'pesto']);
  });

  it('updates prep_time_minutes and cost_index', () => {
    const id = seedRecipe('Pasta pesto');
    updateRecipe(id, { recipe_data: RECIPE_DATA, prep_time_minutes: 35, cost_index: '€€€' });

    const db = getDb();
    const recipe = db.prepare('SELECT prep_time_minutes, cost_index FROM recipes WHERE id = ?').get(id) as { prep_time_minutes: number; cost_index: string };
    expect(recipe.prep_time_minutes).toBe(35);
    expect(recipe.cost_index).toBe('€€€');
  });
});

describe('recipe list aggregation', () => {
  beforeAll(() => getDb());

  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM day_feedback; DELETE FROM menu_days; DELETE FROM menus; DELETE FROM recipes;');
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* ok */ }
  });

  // The exact query used by GET /api/recipes
  const AGGREGATION_QUERY = `
    SELECT r.*,
      COALESCE(SUM(CASE WHEN df.rating = 'lekker' THEN 1 ELSE 0 END), 0) AS feedback_lekker,
      COALESCE(SUM(CASE WHEN df.rating = 'ok' THEN 1 ELSE 0 END), 0) AS feedback_ok,
      COALESCE(SUM(CASE WHEN df.rating = 'minder' THEN 1 ELSE 0 END), 0) AS feedback_minder
    FROM recipes r
    LEFT JOIN menu_days md ON md.recipe_id = r.id
    LEFT JOIN day_feedback df ON df.day_id = md.id
    GROUP BY r.id ORDER BY r.times_used DESC, r.name
  `;

  it('counts feedback per recipe across menus', () => {
    const db = getDb();
    const id = seedRecipe('Pasta pesto');
    const a = seedMenuWithDay(id, 'Pasta pesto', 'active');
    const b = seedMenuWithDay(id, 'Pasta pesto', 'archived');
    db.prepare("INSERT INTO day_feedback (day_id, rating) VALUES (?, 'lekker')").run(a.dayId);
    db.prepare("INSERT INTO day_feedback (day_id, rating) VALUES (?, 'minder')").run(b.dayId);

    const rows = db.prepare(AGGREGATION_QUERY).all() as Array<{ name: string; feedback_lekker: number; feedback_ok: number; feedback_minder: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].feedback_lekker).toBe(1);
    expect(rows[0].feedback_ok).toBe(0);
    expect(rows[0].feedback_minder).toBe(1);
  });

  it('returns zeros for recipes without feedback and defaults favorite to 0', () => {
    const db = getDb();
    seedRecipe('Nasi goreng');
    const rows = db.prepare(AGGREGATION_QUERY).all() as Array<{ feedback_lekker: number; favorite: number }>;
    expect(rows[0].feedback_lekker).toBe(0);
    expect(rows[0].favorite).toBe(0);
  });
});
