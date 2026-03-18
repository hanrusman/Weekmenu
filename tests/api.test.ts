import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// Set test DB path BEFORE importing anything
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-api.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');

describe('API Database Operations', () => {
  beforeAll(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb(); // Initialize
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    const db = getDb();
    db.exec(`
      DELETE FROM menu_days;
      DELETE FROM shopping_items;
      DELETE FROM pantry_check;
      DELETE FROM recipes;
      DELETE FROM menus;
    `);
    // Reset auto-increment
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* table may not exist yet */ }
  });

  describe('Menu CRUD', () => {
    it('should list menus ordered by year and week descending', () => {
      const db = getDb();
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
      const db = getDb();
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (11, 2026, 'draft')").run();
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'active')").run();

      const active = db.prepare("SELECT * FROM menus WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as { week_number: number };
      expect(active).toBeDefined();
      expect(active.week_number).toBe(12);
    });

    it('should activate menu and archive previous using transaction', () => {
      const db = getDb();
      db.prepare("INSERT INTO menus (week_number, year, status) VALUES (11, 2026, 'active')").run();
      const newMenu = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'draft')").run();

      const activate = db.transaction(() => {
        db.prepare("UPDATE menus SET status = 'archived' WHERE status = 'active'").run();
        db.prepare("UPDATE menus SET status = 'active' WHERE id = ?").run(newMenu.lastInsertRowid);
      });
      activate();

      const menus = db.prepare('SELECT * FROM menus ORDER BY week_number').all() as Array<{ status: string }>;
      expect(menus[0].status).toBe('archived');
      expect(menus[1].status).toBe('active');
    });
  });

  describe('Menu Days', () => {
    it('should approve a day', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (12, 2026)").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 0, 'Woensdag', 'Test', '{}', 'pasta')"
      ).run(menu.lastInsertRowid);

      const dayId = (db.prepare('SELECT id FROM menu_days WHERE menu_id = ?').get(menu.lastInsertRowid) as { id: number }).id;
      db.prepare("UPDATE menu_days SET status = 'approved' WHERE id = ?").run(dayId);
      const day = db.prepare('SELECT status FROM menu_days WHERE id = ?').get(dayId) as { status: string };
      expect(day.status).toBe('approved');
    });

    it('should mark day as completed with timestamp', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (13, 2026)").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 0, 'Woensdag', 'Test', '{}', 'pasta')"
      ).run(menu.lastInsertRowid);

      const dayId = (db.prepare('SELECT id FROM menu_days WHERE menu_id = ?').get(menu.lastInsertRowid) as { id: number }).id;
      db.prepare("UPDATE menu_days SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(dayId);

      const day = db.prepare('SELECT status, completed_at FROM menu_days WHERE id = ?').get(dayId) as {
        status: string; completed_at: string;
      };
      expect(day.status).toBe('completed');
      expect(day.completed_at).toBeTruthy();
    });

    it('should get days ordered by day_of_week', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (14, 2026)").run();
      const menuId = menu.lastInsertRowid;

      db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 2, 'Vrijdag', 'F', '{}', 'wrap')").run(menuId);
      db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 0, 'Woensdag', 'W', '{}', 'pasta')").run(menuId);
      db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 1, 'Donderdag', 'D', '{}', 'rijst')").run(menuId);

      const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(menuId) as Array<{ day_name: string }>;
      expect(days[0].day_name).toBe('Woensdag');
      expect(days[1].day_name).toBe('Donderdag');
      expect(days[2].day_name).toBe('Vrijdag');
    });
  });

  describe('Shopping Items', () => {
    it('should group items by product_group', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (15, 2026)").run();
      const menuId = menu.lastInsertRowid;

      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (?, 'groenten', 'tomaat')").run(menuId);
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (?, 'groenten', 'courgette')").run(menuId);
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (?, 'vis', 'zalm')").run(menuId);

      const items = db.prepare('SELECT * FROM shopping_items WHERE menu_id = ? ORDER BY product_group, item_name').all(menuId) as Array<{ product_group: string }>;
      const groups = [...new Set(items.map(i => i.product_group))];
      expect(groups).toContain('groenten');
      expect(groups).toContain('vis');
    });

    it('should toggle item check status', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (16, 2026)").run();
      db.prepare("INSERT INTO shopping_items (menu_id, product_group, item_name) VALUES (?, 'groenten', 'tomaat')").run(menu.lastInsertRowid);
      const itemId = (db.prepare('SELECT id FROM shopping_items WHERE menu_id = ?').get(menu.lastInsertRowid) as { id: number }).id;

      db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = ?').run(itemId);
      let item = db.prepare('SELECT checked FROM shopping_items WHERE id = ?').get(itemId) as { checked: number };
      expect(item.checked).toBe(1);

      db.prepare('UPDATE shopping_items SET checked = 0 WHERE id = ?').run(itemId);
      item = db.prepare('SELECT checked FROM shopping_items WHERE id = ?').get(itemId) as { checked: number };
      expect(item.checked).toBe(0);
    });
  });

  describe('Pantry Check', () => {
    it('should toggle have_it status', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (17, 2026)").run();
      db.prepare("INSERT INTO pantry_check (menu_id, item_name, needed_for_days) VALUES (?, 'olijfolie', '[\"Woensdag\"]')").run(menu.lastInsertRowid);
      const itemId = (db.prepare('SELECT id FROM pantry_check WHERE menu_id = ?').get(menu.lastInsertRowid) as { id: number }).id;

      db.prepare('UPDATE pantry_check SET have_it = 1 WHERE id = ?').run(itemId);
      const item = db.prepare('SELECT have_it FROM pantry_check WHERE id = ?').get(itemId) as { have_it: number };
      expect(item.have_it).toBe(1);
    });
  });

  describe('Recipes', () => {
    it('should add and search recipes by name', () => {
      const db = getDb();
      db.prepare("INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Pasta carbonara', 'manual', '{}', '[\"pasta\"]')").run();
      db.prepare("INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Zalm teriyaki', 'manual', '{}', '[\"vis\"]')").run();

      const results = db.prepare("SELECT * FROM recipes WHERE name LIKE ?").all('%pasta%') as Array<{ name: string }>;
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Pasta carbonara');
    });

    it('should search recipes by tag', () => {
      const db = getDb();
      db.prepare("INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Pasta', 'manual', '{}', '[\"pasta\"]')").run();
      db.prepare("INSERT INTO recipes (name, source, recipe_data, tags) VALUES ('Zalm', 'manual', '{}', '[\"vis\"]')").run();

      const results = db.prepare("SELECT * FROM recipes WHERE tags LIKE ?").all('%vis%') as Array<{ name: string }>;
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Zalm');
    });

    it('should delete a recipe and verify changes', () => {
      const db = getDb();
      const result = db.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES ('Test', 'manual', '{}')").run();
      const deleteResult = db.prepare('DELETE FROM recipes WHERE id = ?').run(result.lastInsertRowid);
      expect(deleteResult.changes).toBe(1);

      const count = db.prepare('SELECT COUNT(*) as c FROM recipes').get() as { c: number };
      expect(count.c).toBe(0);
    });
  });

  describe('Today endpoint logic', () => {
    it("should find today's meal from active menu", () => {
      const db = getDb();
      const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag'];
      const today = dayNames[new Date().getDay()];

      const menu = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (18, 2026, 'active')").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index) VALUES (?, 0, ?, 'Testgerecht', '{\"steps\":[]}', 'pasta', 20, '€')"
      ).run(menu.lastInsertRowid, today);

      const day = db.prepare(`
        SELECT md.* FROM menu_days md
        JOIN menus m ON md.menu_id = m.id
        WHERE m.status = 'active' AND md.day_name = ?
        ORDER BY m.id DESC LIMIT 1
      `).get(today) as { recipe_name: string } | undefined;

      expect(day).toBeDefined();
      expect(day!.recipe_name).toBe('Testgerecht');
    });

    it('should return nothing for Dinsdag (not in menu)', () => {
      const db = getDb();
      const menu = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (19, 2026, 'active')").run();
      db.prepare(
        "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type) VALUES (?, 0, 'Woensdag', 'Test', '{}', 'pasta')"
      ).run(menu.lastInsertRowid);

      const day = db.prepare(`
        SELECT md.* FROM menu_days md JOIN menus m ON md.menu_id = m.id
        WHERE m.status = 'active' AND md.day_name = 'Dinsdag'
      `).get();

      expect(day).toBeUndefined();
    });
  });
});
