import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-course-migration.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, parseRecipeInput } = await import('../server/services/recipes');
const { recipesToBoost } = await import('../server/services/vegetable-job');

function removeFiles() {
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(TEST_DB_PATH + suffix)) fs.unlinkSync(TEST_DB_PATH + suffix);
}

/**
 * A schema version 5 database as it was before this change: without the
 * course column, and with or without the main_course label (production never
 * ran the version that added it). `recipes` are [name, main_course].
 */
function oldDatabase(withLabels: boolean, recipes: Array<[string, number]>) {
  closeDb();
  removeFiles();
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  getDb();
  closeDb();

  const old = new Database(TEST_DB_PATH);
  old.exec('ALTER TABLE recipes DROP COLUMN course');
  if (!withLabels) old.exec('ALTER TABLE recipes DROP COLUMN main_course');
  for (const [name, mainCourse] of recipes) {
    if (withLabels) {
      old.prepare("INSERT INTO recipes (name, source, recipe_data, main_course) VALUES (?, 'import', '{}', ?)").run(name, mainCourse);
    } else {
      old.prepare("INSERT INTO recipes (name, source, recipe_data) VALUES (?, 'import', '{}')").run(name);
    }
  }
  old.pragma('user_version = 5');
  old.close();
}

const rows = () => getDb().prepare('SELECT name, course, main_course FROM recipes ORDER BY name').all();

beforeEach(() => closeDb());

afterAll(() => {
  closeDb();
  removeFiles();
});

describe('course migration (v6)', () => {
  it('leaves the kind of every existing recipe to the run when nothing was marked yet (production)', () => {
    oldDatabase(false, [['Groentehapjes', 1], ['Lasagne', 1]]);

    const db = getDb();
    expect(db.pragma('user_version', { simple: true })).toBe(6);
    expect(rows()).toEqual([
      { name: 'Groentehapjes', course: null, main_course: 0 },
      { name: 'Lasagne', course: null, main_course: 0 },
    ]);

    // Also a recipe that already reaches every norm goes through the run, to have its kind found out
    const id = (db.prepare("SELECT id FROM recipes WHERE name = 'Groentehapjes'").get() as { id: number }).id;
    saveRecipe(db, parseRecipeInput({
      name: 'Groentehapjes', servings: 4, steps: ['Bakken'], ingredients: [
        { name: 'volkoren spaghetti', amount: 400, unit: 'g', product_group: 'droogwaren' },
        { name: 'garnalen', amount: 300, unit: 'g', product_group: 'vis' },
        { name: 'courgette', amount: 1400, unit: 'g', product_group: 'groenten' },
      ],
    }), id);
    expect(rows()[0]).toMatchObject({ course: null });
    expect(recipesToBoost(db)).toContain(id);
  });

  it('keeps former dinners hoofdgerecht when the label was already there, and the others to be found out', () => {
    oldDatabase(true, [['Lasagne', 1], ['Ringtaart', 0]]);

    expect(getDb().pragma('user_version', { simple: true })).toBe(6);
    expect(rows()).toEqual([
      { name: 'Lasagne', course: 'hoofdgerecht', main_course: 1 },
      { name: 'Ringtaart', course: null, main_course: 0 },
    ]);
  });

  it('runs once: a kind set afterwards stays', () => {
    oldDatabase(false, [['Lasagne', 1]]);
    getDb().prepare("UPDATE recipes SET course = 'hoofdgerecht', main_course = 1").run();
    closeDb();

    expect(rows()).toEqual([{ name: 'Lasagne', course: 'hoofdgerecht', main_course: 1 }]);
  });
});
