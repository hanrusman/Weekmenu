import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-migration.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb, migrateStructuredIngredients } = await import('../server/db');

describe('Structured ingredients data migration', () => {
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

  it('derives structured rows from legacy recipe_data and links menu_days by name', () => {
    const db = getDb();

    // Simulate pre-migration data: recipe with JSON-only ingredients,
    // menu day referencing it by name without recipe_id
    db.prepare(
      "INSERT INTO recipes (name, source, recipe_data) VALUES ('Oude curry', 'weekmenu', ?)"
    ).run(JSON.stringify({
      ingredients: [
        { name: 'Uien', amount: '2', unit: 'stuks', product_group: 'groenten' },
        { name: 'kokosmelk', amount: '400', unit: 'ml', product_group: 'droogwaren' },
        { name: 'peper', amount: 'naar smaak', unit: '', product_group: 'kruiden' },
      ],
      steps: ['Snijd de ui'],
    }));

    const menuId = db.prepare("INSERT INTO menus (week_number, year) VALUES (40, 2026)").run().lastInsertRowid as number;
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 0, 'Donderdag', 'Oude curry', '{}', 'rijst')"
    ).run(menuId);

    migrateStructuredIngredients(db);

    const rows = db.prepare(`
      SELECT i.name, ri.amount, ri.unit, ri.raw_text FROM recipe_ingredients ri
      JOIN ingredients i ON ri.ingredient_id = i.id
      JOIN recipes r ON ri.recipe_id = r.id
      WHERE r.name = 'Oude curry'
      ORDER BY i.name
    `).all() as Array<{ name: string; amount: number | null; unit: string; raw_text: string | null }>;

    expect(rows).toEqual([
      { name: 'kokosmelk', amount: 400, unit: 'ml', raw_text: null },
      { name: 'peper', amount: null, unit: '', raw_text: 'naar smaak' },
      { name: 'ui', amount: 2, unit: 'stuks', raw_text: null },
    ]);

    const day = db.prepare('SELECT recipe_id FROM menu_days WHERE menu_id = ?').get(menuId) as { recipe_id: number | null };
    const recipe = db.prepare("SELECT id FROM recipes WHERE name = 'Oude curry'").get() as { id: number };
    expect(day.recipe_id).toBe(recipe.id);
  });

  it('skips recipes with malformed JSON without failing', () => {
    const db = getDb();
    db.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES ('Kapot', 'weekmenu', 'niet json')").run();

    expect(() => migrateStructuredIngredients(db)).not.toThrow();

    const count = db.prepare(`
      SELECT COUNT(*) AS c FROM recipe_ingredients ri
      JOIN recipes r ON ri.recipe_id = r.id
      WHERE r.name = 'Kapot'
    `).get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('is idempotent: re-running does not duplicate rows', () => {
    const db = getDb();
    migrateStructuredIngredients(db);
    const before = db.prepare('SELECT COUNT(*) AS c FROM recipe_ingredients').get() as { c: number };
    migrateStructuredIngredients(db);
    const after = db.prepare('SELECT COUNT(*) AS c FROM recipe_ingredients').get() as { c: number };
    expect(after.c).toBe(before.c);
  });
});
