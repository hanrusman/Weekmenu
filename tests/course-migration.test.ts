import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-course-migration.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');

afterAll(() => {
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(TEST_DB_PATH + suffix)) fs.unlinkSync(TEST_DB_PATH + suffix);
});

describe('course migration (v6)', () => {
  it('makes former dinners hoofdgerecht and leaves the kind of the others to be found out', () => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
    closeDb();

    // A database from before: no course column, schema version 5, one recipe marked as no dinner
    const old = new Database(TEST_DB_PATH);
    old.exec('ALTER TABLE recipes DROP COLUMN course');
    old.prepare("INSERT INTO recipes (name, source, recipe_data, main_course) VALUES ('Lasagne', 'import', '{}', 1)").run();
    old.prepare("INSERT INTO recipes (name, source, recipe_data, main_course) VALUES ('Ringtaart', 'import', '{}', 0)").run();
    old.pragma('user_version = 5');
    old.close();

    const db = getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(db.prepare('SELECT name, course, main_course FROM recipes ORDER BY name').all()).toEqual([
      { name: 'Lasagne', course: 'hoofdgerecht', main_course: 1 },
      { name: 'Ringtaart', course: null, main_course: 0 },
    ]);
  });
});
