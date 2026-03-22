import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-shopping-gen.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { generatePantryCheck } = await import('../server/services/shopping-generator');

describe('Shopping Generator - generatePantryCheck', () => {
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
    db.exec('DELETE FROM pantry_check; DELETE FROM menu_days; DELETE FROM menus;');
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* ok */ }
  });

  it('should generate pantry items from recipe ingredients', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (20, 2026)").run();
    const menuId = menu.lastInsertRowid as number;

    const recipeData = JSON.stringify({
      ingredients: [
        { name: 'olijfolie', amount: '2', unit: 'el', product_group: 'olie' },
        { name: 'pasta', amount: '400', unit: 'g', product_group: 'droogwaren' },
        { name: 'courgette', amount: '2', unit: 'stuks', product_group: 'groenten' },
      ],
      steps: [],
    });

    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'Pasta', ?, 'pasta', 'approved')"
    ).run(menuId, recipeData);

    generatePantryCheck(menuId);

    const pantryItems = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId) as Array<{ item_name: string; quantity: string }>;
    const names = pantryItems.map(p => p.item_name);

    // Should include pantry items (olie, droogwaren) but NOT groenten
    expect(names).toContain('olijfolie');
    expect(names).toContain('pasta');
    expect(names).not.toContain('courgette');

    // Should include quantities
    const olijfolie = pantryItems.find(p => p.item_name === 'olijfolie');
    expect(olijfolie?.quantity).toBe('2 el');
    const pasta = pantryItems.find(p => p.item_name === 'pasta');
    expect(pasta?.quantity).toBe('400 g');
  });

  it('should skip completed days', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (21, 2026)").run();
    const menuId = menu.lastInsertRowid as number;

    const recipeData = JSON.stringify({
      ingredients: [
        { name: 'rijst', amount: '300', unit: 'g', product_group: 'droogwaren' },
      ],
      steps: [],
    });

    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'Rijst', ?, 'rijst', 'completed')"
    ).run(menuId, recipeData);

    generatePantryCheck(menuId);

    const pantryItems = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId);
    expect(pantryItems).toHaveLength(0);
  });

  it('should handle malformed recipe data gracefully', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (22, 2026)").run();
    const menuId = menu.lastInsertRowid as number;

    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'Bad', 'not valid json', 'vrij', 'proposed')"
    ).run(menuId);

    // Should not throw
    expect(() => generatePantryCheck(menuId)).not.toThrow();

    const pantryItems = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId);
    expect(pantryItems).toHaveLength(0);
  });

  it('should aggregate ingredients across multiple days', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (23, 2026)").run();
    const menuId = menu.lastInsertRowid as number;

    const recipeWo = JSON.stringify({
      ingredients: [
        { name: 'olijfolie', amount: '2', unit: 'el', product_group: 'olie' },
      ],
      steps: [],
    });
    const recipeDo = JSON.stringify({
      ingredients: [
        { name: 'olijfolie', amount: '1', unit: 'el', product_group: 'olie' },
        { name: 'sojasaus', amount: '2', unit: 'el', product_group: 'sauzen' },
      ],
      steps: [],
    });

    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'A', ?, 'pasta', 'approved')"
    ).run(menuId, recipeWo);
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 1, 'Donderdag', 'B', ?, 'rijst', 'approved')"
    ).run(menuId, recipeDo);

    generatePantryCheck(menuId);

    const pantryItems = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId) as Array<{
      item_name: string; needed_for_days: string;
    }>;

    const olijfolie = pantryItems.find(p => p.item_name === 'olijfolie');
    expect(olijfolie).toBeDefined();
    const days = JSON.parse(olijfolie!.needed_for_days) as string[];
    expect(days).toContain('Woensdag');
    expect(days).toContain('Donderdag');
  });

  it('should clear existing pantry items before regenerating', () => {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year) VALUES (24, 2026)").run();
    const menuId = menu.lastInsertRowid as number;

    // Insert some old pantry items
    db.prepare("INSERT INTO pantry_check (menu_id, item_name, needed_for_days) VALUES (?, 'old item', '[]')").run(menuId);
    expect(db.prepare('SELECT COUNT(*) as c FROM pantry_check WHERE menu_id = ?').get(menuId)).toEqual({ c: 1 });

    generatePantryCheck(menuId);

    // Old items should be cleared, no new ones since no days exist
    const items = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId);
    expect(items).toHaveLength(0);
  });
});
