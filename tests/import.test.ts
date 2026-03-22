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
      day_name: 'Woensdag',
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
      day_name: 'Donderdag',
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
  ],
  shopping_list: [
    {
      product_group: 'droogwaren',
      items: [
        { name: 'pasta', quantity: '400g', for_days: ['Woensdag'], is_perishable: false },
        { name: 'rijst', quantity: '300g', for_days: ['Donderdag'], is_perishable: false },
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

  it('should import a valid menu as active with approved days', () => {
    const menuId = importMenu(VALID_MENU, 12, 2026);
    expect(menuId).toBeGreaterThan(0);

    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId) as { week_number: number; year: number; status: string };
    expect(menu.week_number).toBe(12);
    expect(menu.year).toBe(2026);
    expect(menu.status).toBe('active');

    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ?').all(menuId) as Array<{ status: string }>;
    expect(days).toHaveLength(2);
    expect(days[0].status).toBe('approved');
    expect(days[1].status).toBe('approved');

    const items = db.prepare('SELECT * FROM shopping_items WHERE menu_id = ?').all(menuId);
    expect(items).toHaveLength(2);
  });

  it('should archive previous active menu on import', () => {
    const db = getDb();
    db.prepare("INSERT INTO menus (week_number, year, status) VALUES (11, 2026, 'active')").run();

    importMenu(VALID_MENU, 12, 2026);

    const oldMenu = db.prepare("SELECT status FROM menus WHERE week_number = 11 AND year = 2026").get() as { status: string };
    expect(oldMenu.status).toBe('archived');
  });

  it('should replace existing menu for same week/year', () => {
    const id1 = importMenu(VALID_MENU, 12, 2026);
    const id2 = importMenu(VALID_MENU, 12, 2026);
    expect(id2).not.toBe(id1);

    const db = getDb();
    const old = db.prepare('SELECT * FROM menus WHERE id = ?').get(id1);
    expect(old).toBeUndefined();
  });

  it('should generate pantry check on import', () => {
    const menuId = importMenu(VALID_MENU, 12, 2026);
    const db = getDb();
    const pantryItems = db.prepare('SELECT * FROM pantry_check WHERE menu_id = ?').all(menuId);
    // The recipes have droogwaren (pasta, rijst) and sauzen (pesto) - all are pantry items
    expect(pantryItems.length).toBeGreaterThan(0);
  });

  it('should reject invalid JSON structure', () => {
    expect(() => importMenu({ days: 'not an array' }, 12, 2026)).toThrow();
  });

  it('should reject empty days array', () => {
    expect(() => importMenu({ days: [], shopping_list: [], snack_suggestions: [] }, 12, 2026)).toThrow();
  });

  it('should handle optional snack_suggestions', () => {
    const menuWithoutSnacks = { ...VALID_MENU, snack_suggestions: undefined };
    const menuId = importMenu(menuWithoutSnacks, 13, 2026);
    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId) as { snack_suggestions: string };
    expect(JSON.parse(menu.snack_suggestions)).toEqual([]);
  });
});

describe('getTargetWeek', () => {
  it('should target current week on Wednesday', () => {
    // 2026-03-25 is a Wednesday, week 13
    const wed = new Date(2026, 2, 25);
    const result = getTargetWeek(wed);
    expect(result.weekNumber).toBe(13);
  });

  it('should target next week on Saturday', () => {
    // 2026-03-21 is a Saturday (week 12), next Wed is 2026-03-25 (week 13)
    const sat = new Date(2026, 2, 21);
    const result = getTargetWeek(sat);
    expect(result.weekNumber).toBe(13);
  });

  it('should target next week on Sunday', () => {
    // 2026-03-22 is a Sunday (week 12), next Wed is 2026-03-25 (week 13)
    const sun = new Date(2026, 2, 22);
    const result = getTargetWeek(sun);
    expect(result.weekNumber).toBe(13);
  });

  it('should target current week on Thursday', () => {
    // 2026-03-26 is a Thursday, still in the Wed-Mon menu week 13
    const thu = new Date(2026, 2, 26);
    const result = getTargetWeek(thu);
    expect(result.weekNumber).toBe(13);
  });

  it('should target next week on Monday', () => {
    // 2026-03-23 is a Monday (week 13 by ISO), next Wed is 2026-03-25 (week 13)
    const mon = new Date(2026, 2, 23);
    const result = getTargetWeek(mon);
    expect(result.weekNumber).toBe(13);
  });
});
