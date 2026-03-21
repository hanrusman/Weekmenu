import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Set test DB path BEFORE importing db module
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-db.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

// Now import the real db module
const { getDb, closeDb } = await import('../server/db');

describe('Database Schema (real db.ts)', () => {
  beforeAll(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should create all tables via migrate()', () => {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual(['day_feedback', 'menu_days', 'menus', 'pantry_check', 'recipes', 'shopping_items']);
  });

  it('should enable WAL mode', () => {
    const db = getDb();
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const db = getDb();
    const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(result[0].foreign_keys).toBe(1);
  });

  it('should insert and retrieve a menu', () => {
    const db = getDb();
    const result = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'draft')").run();
    expect(result.lastInsertRowid).toBeGreaterThan(0);

    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(result.lastInsertRowid) as {
      week_number: number; year: number; status: string;
    };
    expect(menu.week_number).toBe(12);
    expect(menu.year).toBe(2026);
    expect(menu.status).toBe('draft');
  });

  it('should enforce unique week_number + year constraint', () => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO menus (week_number, year) VALUES (99, 2099)").run();
    expect(() => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (99, 2099)").run();
    }).toThrow();
  });

  it('should cascade delete menu_days when menu is deleted', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (50, 2026)").run();
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 0, 'Woensdag', 'Test', '{}', 'pasta')"
    ).run(menu.lastInsertRowid);

    db.prepare('DELETE FROM menus WHERE id = ?').run(menu.lastInsertRowid);
    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ?').all(menu.lastInsertRowid);
    expect(days).toHaveLength(0);
  });

  it('should cascade delete shopping_items when menu is deleted', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (51, 2026)").run();
    db.prepare(
      "INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (?, 'groenten', 'tomaat')"
    ).run(menu.lastInsertRowid);

    db.prepare('DELETE FROM menus WHERE id = ?').run(menu.lastInsertRowid);
    const items = db.prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menu.lastInsertRowid);
    expect(items).toHaveLength(0);
  });

  it('should handle recipes independently of menus', () => {
    const db = getDb();
    const result = db.prepare(
      "INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Pasta pesto', 'manual', '{}', '[\"pasta\"]')"
    ).run();

    const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid) as {
      name: string; times_used: number;
    };
    expect(recipe.name).toBe('Pasta pesto');
    expect(recipe.times_used).toBe(0);
  });
});
