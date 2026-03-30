import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-import.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { importMenu, getTargetWeek } = await import('../server/services/menu-generator');

const VALID_MENU = {
  days: [
    {
      day_name: 'Donderdag',
      recipe_name: 'Pasta pesto',
      meal_type: 'pasta',
      prep_time_minutes: 20,
      cost_index: '€',
      recipe: {
        ingredients: [
          { name: 'pasta', amount: '400', unit: 'g', product_group: 'droogwaren' },
          { name: 'pesto', amount: '100', unit: 'g', product_group: 'sauzen' },
        ],
        steps: ['Kook de pasta', 'Meng met pesto'],
        nutrition_per_serving: { calories: 450, protein_g: 18, fiber_g: 6, iron_mg: 2.5 },
      },
    },
    {
      day_name: 'Vrijdag',
      recipe_name: 'Nasi goreng',
      meal_type: 'rijst',
      prep_time_minutes: 25,
      cost_index: '€€',
      recipe: {
        ingredients: [
          { name: 'rijst', amount: '300', unit: 'g', product_group: 'droogwaren' },
        ],
        steps: ['Kook de rijst', 'Bak de groenten'],
        nutrition_per_serving: { calories: 500, protein_g: 22, fiber_g: 5, iron_mg: 3.0 },
      },
    },
    {
      day_name: 'Maandag',
      recipe_name: 'Wraps',
      meal_type: 'wrap',
      prep_time_minutes: 15,
      cost_index: '€',
      recipe: {
        ingredients: [
          { name: 'wraps', amount: '4', unit: 'stuks', product_group: 'droogwaren' },
        ],
        steps: ['Vul de wraps'],
        nutrition_per_serving: { calories: 400, protein_g: 20, fiber_g: 4, iron_mg: 2.0 },
      },
    },
  ],
  shopping_list: [
    {
      product_group: 'droogwaren',
      items: [
        { name: 'pasta', quantity: '400g', for_days: ['Donderdag'], is_perishable: false },
        { name: 'rijst', quantity: '300g', for_days: ['Vrijdag'], is_perishable: false },
      ],
    },
  ],
  snack_suggestions: ['Appel met pindakaas'],
};

describe('Menu Import', () => {
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
    db.exec('DELETE FROM day_feedback; DELETE FROM pantry_check; DELETE FROM menu_days; DELETE FROM shopping_items; DELETE FROM menus;');
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* ok */ }
  });

  it('should import a valid menu as active with approved days and dates', () => {
    const menuId = importMenu(VALID_MENU, 14, 2026);
    expect(menuId).toBeGreaterThan(0);

    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId) as { week_number: number; year: number; status: string };
    expect(menu.week_number).toBe(14);
    expect(menu.year).toBe(2026);
    expect(menu.status).toBe('active');

    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(menuId) as Array<{ status: string; date: string; day_name: string }>;
    expect(days).toHaveLength(3);
    expect(days[0].status).toBe('approved');

    // Week 14, 2026: Monday is 2026-03-30
    // Donderdag = 2026-04-02, Vrijdag = 2026-04-03
    // Maandag is AFTER Thursday start, so next week: 2026-04-06
    expect(days[0].date).toBe('2026-04-02'); // Donderdag
    expect(days[1].date).toBe('2026-04-03'); // Vrijdag
    expect(days[2].date).toBe('2026-04-06'); // Maandag (next week)
  });

  it('should keep previous active menu active on import (rolling calendar)', () => {
    const db = getDb();
    db.prepare("INSERT INTO menus (week_number, year, status) VALUES (13, 2026, 'active')").run();

    importMenu(VALID_MENU, 14, 2026);

    const oldMenu = db.prepare("SELECT status FROM menus WHERE week_number = 13 AND year = 2026").get() as { status: string };
    expect(oldMenu.status).toBe('active');

    const activeCount = db.prepare("SELECT COUNT(*) as c FROM menus WHERE status = 'active'").get() as { c: number };
    expect(activeCount.c).toBe(2);
  });

  it('should replace existing menu for same week/year', () => {
    const id1 = importMenu(VALID_MENU, 14, 2026);
    const id2 = importMenu(VALID_MENU, 14, 2026);
    expect(id2).not.toBe(id1);

    const db = getDb();
    const old = db.prepare('SELECT * FROM menus WHERE id = ?').get(id1);
    expect(old).toBeUndefined();
  });

  it('should generate pantry check on import', () => {
    const menuId = importMenu(VALID_MENU, 14, 2026);
    const db = getDb();
    const pantryItems = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId);
    expect(pantryItems.length).toBeGreaterThan(0);
  });

  it('should reject invalid JSON structure', () => {
    expect(() => importMenu({ days: 'not an array' }, 14, 2026)).toThrow();
  });

  it('should reject empty days array', () => {
    expect(() => importMenu({ days: [], shopping_list: [], snack_suggestions: [] }, 14, 2026)).toThrow();
  });

  it('should handle optional snack_suggestions', () => {
    const menuWithoutSnacks = { ...VALID_MENU, snack_suggestions: undefined };
    const menuId = importMenu(menuWithoutSnacks, 15, 2026);
    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId) as { snack_suggestions: string };
    expect(JSON.parse(menu.snack_suggestions)).toEqual([]);
  });
});

describe('getTargetWeek', () => {
  it('should target current week on Thursday', () => {
    // 2026-04-02 is a Thursday, week 14
    const thu = new Date(2026, 3, 2);
    const result = getTargetWeek(thu);
    expect(result.weekNumber).toBe(14);
  });

  it('should target current week on Friday', () => {
    // 2026-04-03 is a Friday, week 14
    const fri = new Date(2026, 3, 3);
    const result = getTargetWeek(fri);
    expect(result.weekNumber).toBe(14);
  });

  it('should target next week on Saturday', () => {
    // 2026-04-04 is a Saturday (week 14), next Thu is 2026-04-09 (week 15)
    const sat = new Date(2026, 3, 4);
    const result = getTargetWeek(sat);
    expect(result.weekNumber).toBe(15);
  });

  it('should target next week on Sunday', () => {
    // 2026-04-05 is a Sunday, next Thu is 2026-04-09 (week 15)
    const sun = new Date(2026, 3, 5);
    const result = getTargetWeek(sun);
    expect(result.weekNumber).toBe(15);
  });

  it('should target next week on Wednesday', () => {
    // 2026-04-08 is a Wednesday, next Thu is 2026-04-09 (week 15)
    const wed = new Date(2026, 3, 8);
    const result = getTargetWeek(wed);
    expect(result.weekNumber).toBe(15);
  });
});
