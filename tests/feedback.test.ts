import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-feedback.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');

describe('Feedback', () => {
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
    db.exec('DELETE FROM day_feedback; DELETE FROM menu_days; DELETE FROM shopping_items; DELETE FROM pantry_check; DELETE FROM menus;');
    try { db.exec('DELETE FROM sqlite_sequence;'); } catch { /* ok */ }
  });

  function createMenuWithDay() {
    const db = getDb();
    const menu = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (12, 2026, 'active')").run();
    const menuId = menu.lastInsertRowid as number;
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'Pasta pesto', '{}', 'pasta', 'completed')"
    ).run(menuId);
    const day = db.prepare('SELECT id FROM menu_days WHERE menu_id = ?').get(menuId) as { id: number };
    return { menuId, dayId: day.id };
  }

  it('should create day_feedback table', () => {
    const db = getDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='day_feedback'").all();
    expect(tables).toHaveLength(1);
  });

  it('should insert feedback for a day', () => {
    const { dayId } = createMenuWithDay();
    const db = getDb();

    db.prepare("INSERT INTO day_feedback (day_id, rating, notes) VALUES (?, 'lekker', 'Heel lekker!')").run(dayId);

    const feedback = db.prepare('SELECT * FROM day_feedback WHERE day_id = ?').get(dayId) as { rating: string; notes: string };
    expect(feedback.rating).toBe('lekker');
    expect(feedback.notes).toBe('Heel lekker!');
  });

  it('should enforce unique day_id constraint (upsert)', () => {
    const { dayId } = createMenuWithDay();
    const db = getDb();

    db.prepare("INSERT INTO day_feedback (day_id, rating) VALUES (?, 'lekker')").run(dayId);
    db.prepare(`
      INSERT INTO day_feedback (day_id, rating, notes) VALUES (?, 'minder', 'Te zout')
      ON CONFLICT(day_id) DO UPDATE SET rating = excluded.rating, notes = excluded.notes
    `).run(dayId);

    const feedback = db.prepare('SELECT * FROM day_feedback WHERE day_id = ?').get(dayId) as { rating: string; notes: string };
    expect(feedback.rating).toBe('minder');
    expect(feedback.notes).toBe('Te zout');
  });

  it('should enforce valid rating values', () => {
    const { dayId } = createMenuWithDay();
    const db = getDb();

    expect(() => {
      db.prepare("INSERT INTO day_feedback (day_id, rating) VALUES (?, 'geweldig')").run(dayId);
    }).toThrow();
  });

  it('should cascade delete when menu_day is deleted', () => {
    const { menuId, dayId } = createMenuWithDay();
    const db = getDb();

    db.prepare("INSERT INTO day_feedback (day_id, rating) VALUES (?, 'ok')").run(dayId);

    // Delete the menu (cascades to menu_days, which cascades to day_feedback)
    db.prepare('DELETE FROM menus WHERE id = ?').run(menuId);

    const feedback = db.prepare('SELECT * FROM day_feedback WHERE day_id = ?').all(dayId);
    expect(feedback).toHaveLength(0);
  });

  it('should query feedback across menus', () => {
    const db = getDb();

    // Create two menus with feedback
    const m1 = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (10, 2026, 'archived')").run();
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'Soep', '{}', 'vrij', 'completed')"
    ).run(m1.lastInsertRowid);
    const d1 = db.prepare('SELECT id FROM menu_days WHERE menu_id = ?').get(m1.lastInsertRowid) as { id: number };
    db.prepare("INSERT INTO day_feedback (day_id, rating, notes) VALUES (?, 'lekker', 'Top')").run(d1.id);

    const m2 = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (11, 2026, 'active')").run();
    db.prepare(
      "INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, status) VALUES (?, 0, 'Woensdag', 'Curry', '{}', 'rijst', 'completed')"
    ).run(m2.lastInsertRowid);
    const d2 = db.prepare('SELECT id FROM menu_days WHERE menu_id = ?').get(m2.lastInsertRowid) as { id: number };
    db.prepare("INSERT INTO day_feedback (day_id, rating, notes) VALUES (?, 'minder', 'Te pittig')").run(d2.id);

    const allFeedback = db.prepare(`
      SELECT m.week_number, md.recipe_name, df.rating, df.notes
      FROM day_feedback df
      JOIN menu_days md ON df.day_id = md.id
      JOIN menus m ON md.menu_id = m.id
      ORDER BY m.week_number DESC
    `).all() as Array<{ week_number: number; recipe_name: string; rating: string; notes: string }>;

    expect(allFeedback).toHaveLength(2);
    expect(allFeedback[0].recipe_name).toBe('Curry');
    expect(allFeedback[0].rating).toBe('minder');
    expect(allFeedback[1].recipe_name).toBe('Soep');
  });
});
