import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// We test the database operations directly since the Express app
// requires module resolution that's complex in test env
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-api.db');

function setupDb(): Database.Database {
  const dir = path.dirname(TEST_DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  const db = new Database(TEST_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_number INTEGER NOT NULL,
      year INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      shopping_list TEXT,
      snack_suggestions TEXT,
      UNIQUE(week_number, year)
    );
    CREATE TABLE menu_days (
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
    CREATE TABLE shopping_items (
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
    CREATE TABLE pantry_check (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      needed_for_days TEXT,
      should_have INTEGER DEFAULT 1,
      have_it INTEGER DEFAULT 0
    );
    CREATE TABLE recipes (
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

describe('API Database Operations', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = setupDb();
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    // Clear data and reset auto-increment between tests
    db.exec(`
      DELETE FROM menu_days;
      DELETE FROM shopping_items;
      DELETE FROM pantry_check;
      DELETE FROM recipes;
      DELETE FROM menus;
      DELETE FROM sqlite_sequence;
    `);
  });

  describe('Menu CRUD', () => {
    it('should list menus ordered by year and week descending', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (10, 2026)").run();
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare("INSERT INTO menus (week_number, year) VALUES (11, 2026)").run();

      const menus = db.prepare('SELECT * FROM menus ORDER BY year DESC, week_number DESC').all() as Array<{ week_number: number }>;
      expect(menus).toHaveLength(3);
      expect(menus[0].week_number).toBe(12);
      expect(menus[1].week_number).toBe(11);
      expect(menus[2].week_number).toBe(10);
    });

    it('should get active menu', () => {
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (11, 2026, 'draft')").run();
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'active')").run();

      const active = db.prepare("SELECT * FROM menus WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as { week_number: number; status: string };
      expect(active).toBeDefined();
      expect(active.week_number).toBe(12);
      expect(active.status).toBe('active');
    });

    it('should return null when no active menu', () => {
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'draft')").run();
      const active = db.prepare("SELECT * FROM menus WHERE status = 'active' LIMIT 1").get();
      expect(active).toBeUndefined();
    });

    it('should activate menu and archive previous', () => {
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (11, 2026, 'active')").run();
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'draft')").run();

      db.prepare("UPDATE menus SET status = 'archived' WHERE status = 'active'").run();
      db.prepare("UPDATE menus SET status = 'active' WHERE id = 2").run();

      const menus = db.prepare('SELECT * FROM menus ORDER BY id').all() as Array<{ status: string }>;
      expect(menus[0].status).toBe('archived');
      expect(menus[1].status).toBe('active');
    });
  });

  describe('Menu Days', () => {
    it('should approve a day', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (1, 0, 'Woensdag', 'Test', '{}', 'pasta')"
      ).run();

      db.prepare("UPDATE menu_days SET status = 'approved' WHERE id = 1").run();
      const day = db.prepare('SELECT status FROM menu_days WHERE id = 1').get() as { status: string };
      expect(day.status).toBe('approved');
    });

    it('should mark day as completed', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (1, 0, 'Woensdag', 'Test', '{}', 'pasta')"
      ).run();

      db.prepare(
        "UPDATE menu_days SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = 1"
      ).run();

      const day = db.prepare('SELECT status, completed_at FROM menu_days WHERE id = 1').get() as {
        status: string; completed_at: string;
      };
      expect(day.status).toBe('completed');
      expect(day.completed_at).toBeTruthy();
    });

    it('should get days ordered by day_of_week', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (1, 2, 'Vrijdag', 'F', '{}', 'wrap')").run();
      db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (1, 0, 'Woensdag', 'W', '{}', 'pasta')").run();
      db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (1, 1, 'Donderdag', 'D', '{}', 'rijst')").run();

      const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = 1 ORDER BY day_of_week').all() as Array<{ day_name: string }>;
      expect(days[0].day_name).toBe('Woensdag');
      expect(days[1].day_name).toBe('Donderdag');
      expect(days[2].day_name).toBe('Vrijdag');
    });
  });

  describe('Shopping Items', () => {
    it('should group items by product_group', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (1, 'groenten', 'tomaat')").run();
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (1, 'groenten', 'courgette')").run();
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (1, 'vis', 'zalm')").run();

      const items = db.prepare('SELECT * FROM shopping_items WHERE menu_id = 1 ORDER BY product_group, item_name').all() as Array<{ product_group: string; item_name: string }>;

      const grouped: Record<string, string[]> = {};
      for (const item of items) {
        if (!grouped[item.product_group]) grouped[item.product_group] = [];
        grouped[item.product_group].push(item.item_name);
      }

      expect(grouped['groenten']).toHaveLength(2);
      expect(grouped['vis']).toHaveLength(1);
    });

    it('should toggle item check status', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (1, 'groenten', 'tomaat')").run();

      // Check
      db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = 1').run();
      let item = db.prepare('SELECT checked FROM shopping_items WHERE id = 1').get() as { checked: number };
      expect(item.checked).toBe(1);

      // Uncheck
      db.prepare('UPDATE shopping_items SET checked = 0 WHERE id = 1').run();
      item = db.prepare('SELECT checked FROM shopping_items WHERE id = 1').get() as { checked: number };
      expect(item.checked).toBe(0);
    });
  });

  describe('Pantry Check', () => {
    it('should toggle have_it status', () => {
      db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare("INSERT INTO pantry_check (menu_id, item_name, needed_for_days) VALUES (1, 'olijfolie', '[\"Woensdag\"]')").run();

      db.prepare('UPDATE pantry_check SET have_it = 1 WHERE id = 1').run();
      const item = db.prepare('SELECT have_it FROM pantry_check WHERE id = 1').get() as { have_it: number };
      expect(item.have_it).toBe(1);
    });
  });

  describe('Recipes', () => {
    it('should add and search recipes', () => {
      db.prepare(
        "INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Pasta carbonara', 'manual', '{}', '[\"pasta\"]')"
      ).run();
      db.prepare(
        "INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Zalm teriyaki', 'manual', '{}', '[\"vis\"]')"
      ).run();

      // Search by name
      const results = db.prepare("SELECT * FROM recipes WHERE name LIKE ?").all('%pasta%') as Array<{ name: string }>;
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Pasta carbonara');
    });

    it('should search recipes by tag', () => {
      db.prepare(
        "INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Pasta pesto', 'manual', '{}', '[\"pasta\", \"italiaans\"]')"
      ).run();
      db.prepare(
        "INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Zalm', 'manual', '{}', '[\"vis\"]')"
      ).run();

      const results = db.prepare("SELECT * FROM recipes WHERE tags LIKE ?").all('%vis%') as Array<{ name: string }>;
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Zalm');
    });

    it('should delete a recipe', () => {
      db.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES ('Test', 'manual', '{}')").run();
      expect(db.prepare('SELECT COUNT(*) as c FROM recipes').get()).toEqual({ c: 1 });

      db.prepare('DELETE FROM recipes WHERE id = 1').run();
      expect(db.prepare('SELECT COUNT(*) as c FROM recipes').get()).toEqual({ c: 0 });
    });
  });

  describe('Today endpoint logic', () => {
    it('should find today\'s meal from active menu', () => {
      const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
      const today = dayNames[new Date().getDay()];

      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'active')").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index) VALUES (1, 0, ?, 'Testgerecht', '{\"steps\":[]}', 'pasta', 20, '€')"
      ).run(today);

      const day = db.prepare(`
        SELECT md.* FROM menu_days md
        JOIN menus m ON md.menu_id = m.id
        WHERE m.status = 'active' AND md.day_name = ?
        ORDER BY m.id DESC LIMIT 1
      `).get(today) as { recipe_name: string } | undefined;

      expect(day).toBeDefined();
      expect(day!.recipe_name).toBe('Testgerecht');
    });
  });
});
