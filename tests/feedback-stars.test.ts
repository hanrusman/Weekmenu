import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-feedback-stars.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');

describe('Feedback from lekker / ok / minder to stars', () => {
  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('turns the three words into 5, 3 and 1 stars, keeping notes and dates', () => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    // A database from before the stars
    const old = new Database(TEST_DB_PATH);
    old.exec(`
      CREATE TABLE menus (id INTEGER PRIMARY KEY AUTOINCREMENT, week_number INTEGER NOT NULL, year INTEGER NOT NULL,
        status TEXT DEFAULT 'draft', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, shopping_list TEXT, snack_suggestions TEXT,
        UNIQUE(week_number, year));
      CREATE TABLE menu_days (id INTEGER PRIMARY KEY AUTOINCREMENT, menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL, day_name TEXT NOT NULL, recipe_name TEXT NOT NULL, recipe_data TEXT NOT NULL,
        meal_type TEXT, prep_time_minutes INTEGER, cost_index TEXT, status TEXT DEFAULT 'proposed', completed_at DATETIME, notes TEXT);
      CREATE TABLE day_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, day_id INTEGER NOT NULL REFERENCES menu_days(id) ON DELETE CASCADE,
        rating TEXT NOT NULL CHECK(rating IN ('lekker', 'ok', 'minder')), notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(day_id));
      INSERT INTO menus (week_number, year) VALUES (1, 2026);
      INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data) VALUES (1, 0, 'Dag', 'A', '{}'), (1, 1, 'Dag', 'B', '{}'), (1, 2, 'Dag', 'C', '{}');
      INSERT INTO day_feedback (day_id, rating, notes, created_at) VALUES
        (1, 'lekker', 'Top', '2026-01-01 18:00:00'), (2, 'ok', NULL, '2026-01-02 18:00:00'), (3, 'minder', 'Te zout', '2026-01-03 18:00:00');
    `);
    old.close();

    const db = getDb();
    const rows = db.prepare('SELECT day_id, stars, notes, created_at FROM day_feedback ORDER BY day_id').all();
    expect(rows).toEqual([
      { day_id: 1, stars: 5, notes: 'Top', created_at: '2026-01-01 18:00:00' },
      { day_id: 2, stars: 3, notes: null, created_at: '2026-01-02 18:00:00' },
      { day_id: 3, stars: 1, notes: 'Te zout', created_at: '2026-01-03 18:00:00' },
    ]);
    const cols = (db.prepare('PRAGMA table_info(day_feedback)').all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain('rating');

    // Still cascades from its menu day
    db.prepare('DELETE FROM menus').run();
    expect(db.prepare('SELECT COUNT(*) AS c FROM day_feedback').get()).toEqual({ c: 0 });
  });
});
