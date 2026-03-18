import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-weekmenu.db');

function createTestDb(): Database.Database {
  // Ensure data dir exists
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Remove old test DB
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_number INTEGER NOT NULL,
      year INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      shopping_list TEXT,
      snack_suggestions TEXT,
      UNIQUE(week_number, year)
    );

    CREATE TABLE IF NOT EXISTS menu_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL,
      day_name TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      recipe_data TEXT NOT NULL,
      meal_type TEXT,
      prep_time_minutes INTEGER,
      cost_index TEXT,
      status TEXT DEFAULT 'proposed',
      completed_at DATETIME,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS shopping_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      product_group TEXT NOT NULL,
      item_name TEXT NOT NULL,
      quantity TEXT,
      for_days TEXT,
      is_perishable INTEGER DEFAULT 0,
      checked INTEGER DEFAULT 0,
      storage_tip TEXT
    );

    CREATE TABLE IF NOT EXISTS pantry_check (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      needed_for_days TEXT,
      should_have INTEGER DEFAULT 1,
      have_it INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT,
      recipe_data TEXT NOT NULL,
      tags TEXT,
      times_used INTEGER DEFAULT 0,
      last_used DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

describe('Database Schema', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should create all tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(['menu_days', 'menus', 'pantry_check', 'recipes', 'shopping_items']);
  });

  it('should insert and retrieve a menu', () => {
    const result = db.prepare(
      "INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'draft')"
    ).run();
    expect(result.lastInsertRowid).toBe(1);

    const menu = db.prepare('SELECT * FROM menus WHERE id = 1').get() as {
      id: number; week_number: number; year: number; status: string;
    };
    expect(menu.week_number).toBe(12);
    expect(menu.year).toBe(2026);
    expect(menu.status).toBe('draft');
  });

  it('should enforce unique week_number + year constraint', () => {
    db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
    expect(() => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
    }).toThrow();
  });

  it('should insert and retrieve menu days', () => {
    db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();

    const recipeData = JSON.stringify({
      ingredients: [{ name: 'pasta', amount: '400', unit: 'g', product_group: 'droogwaren' }],
      steps: ['Kook de pasta'],
      nutrition_per_serving: { calories: 400, protein_g: 15, fiber_g: 5, iron_mg: 2 },
    });

    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index) VALUES (1, 0, 'Woensdag', 'Pasta pesto', ?, 'pasta', 20, '€')"
    ).run(recipeData);

    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = 1').all() as Array<{
      recipe_name: string; day_name: string; meal_type: string;
    }>;
    expect(days).toHaveLength(1);
    expect(days[0].recipe_name).toBe('Pasta pesto');
    expect(days[0].day_name).toBe('Woensdag');
    expect(days[0].meal_type).toBe('pasta');
  });

  it('should cascade delete menu days when menu is deleted', () => {
    db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (1, 0, 'Woensdag', 'Test', '{}', 'pasta')"
    ).run();

    db.prepare('DELETE FROM menus WHERE id = 1').run();
    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = 1').all();
    expect(days).toHaveLength(0);
  });

  it('should handle shopping items', () => {
    db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
    db.prepare(
      "INSERT INTO shopping_items (menu_id, product_group, item_name, quantity, for_days, is_perishable) VALUES (1, 'groenten', 'courgette', '3 stuks', '[\"Woensdag\"]', 1)"
    ).run();

    const items = db.prepare('SELECT * FROM shopping_items WHERE menu_id = 1').all() as Array<{
      item_name: string; is_perishable: number; checked: number;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].item_name).toBe('courgette');
    expect(items[0].is_perishable).toBe(1);
    expect(items[0].checked).toBe(0);
  });

  it('should toggle shopping item check', () => {
    db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
    db.prepare(
      "INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (1, 'groenten', 'tomaat')"
    ).run();

    db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = 1').run();
    const item = db.prepare('SELECT checked FROM shopping_items WHERE id = 1').get() as { checked: number };
    expect(item.checked).toBe(1);
  });

  it('should handle pantry check items', () => {
    db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
    db.prepare(
      "INSERT INTO pantry_check (menu_id, item_name, needed_for_days) VALUES (1, 'olijfolie', '[\"Woensdag\", \"Donderdag\"]')"
    ).run();

    const items = db.prepare('SELECT * FROM pantry_check WHERE menu_id = 1').all() as Array<{
      item_name: string; have_it: number;
    }>;
    expect(items).toHaveLength(1);
    expect(items[0].item_name).toBe('olijfolie');
    expect(items[0].have_it).toBe(0);
  });

  it('should handle recipes', () => {
    const recipeData = JSON.stringify({
      ingredients: [],
      steps: ['Test'],
      nutrition_per_serving: { calories: 300, protein_g: 20, fiber_g: 5, iron_mg: 2 },
    });

    db.prepare(
      "INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Pasta carbonara', 'manual', ?, '[\"pasta\", \"italiaans\"]')"
    ).run(recipeData);

    const recipe = db.prepare('SELECT * FROM recipes WHERE id = 1').get() as {
      name: string; times_used: number; tags: string;
    };
    expect(recipe.name).toBe('Pasta carbonara');
    expect(recipe.times_used).toBe(0);
    expect(JSON.parse(recipe.tags)).toEqual(['pasta', 'italiaans']);
  });
});
