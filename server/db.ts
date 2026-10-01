import Database from 'better-sqlite3';
import path from 'path';
import { syncRecipeIngredients, SEED_ALIASES } from './services/ingredients.js';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'weekmenu.db');

let db: Database.Database;

/** Recipe pictures live next to the database, on the data volume. */
export function recipeImagesDir(): string {
  return path.join(path.dirname(DB_PATH), 'images', 'recipes');
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS menus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_number INTEGER NOT NULL,
      year INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      shopping_list TEXT,
      snack_suggestions TEXT,
      UNIQUE(week_number, year)
    );

    CREATE TABLE IF NOT EXISTS menu_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      day_of_week INTEGER NOT NULL,
      day_name TEXT NOT NULL,
      recipe_name TEXT NOT NULL,
      recipe_data TEXT NOT NULL,
      meal_type TEXT,
      prep_time_minutes INTEGER,
      cost_index TEXT,
      date TEXT,
      status TEXT DEFAULT 'proposed',
      completed_at DATETIME,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS shopping_items (
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

    CREATE TABLE IF NOT EXISTS pantry_check (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
      item_name TEXT NOT NULL,
      quantity TEXT,
      needed_for_days TEXT,
      should_have INTEGER DEFAULT 1,
      have_it INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      source TEXT,
      recipe_data TEXT NOT NULL,
      tags TEXT,
      times_used INTEGER DEFAULT 0,
      last_used DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      unit TEXT NOT NULL DEFAULT '',
      product_group TEXT NOT NULL DEFAULT 'overig',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      amount REAL,
      unit TEXT NOT NULL DEFAULT '',
      raw_text TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

    -- A recipe as it was before an automatic change (vegetable top-up), for undo
    CREATE TABLE IF NOT EXISTS recipe_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      input TEXT NOT NULL,
      veg_before INTEGER,
      veg_after INTEGER,
      summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Alternative spellings that resolve to a canonical ingredient name
    CREATE TABLE IF NOT EXISTS ingredient_aliases (
      alias TEXT PRIMARY KEY,
      canonical TEXT NOT NULL
    );

    -- 1 <unit> of this ingredient = factor x the ingredient's own unit
    CREATE TABLE IF NOT EXISTS ingredient_conversions (
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
      unit TEXT NOT NULL,
      factor REAL NOT NULL CHECK(factor > 0),
      PRIMARY KEY (ingredient_id, unit)
    );

    CREATE TABLE IF NOT EXISTS day_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES menu_days(id) ON DELETE CASCADE,
      rating TEXT NOT NULL CHECK(rating IN ('lekker', 'ok', 'minder')),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(day_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  // Migrations for existing databases
  addColumnIfMissing(db, 'pantry_check', 'quantity', 'TEXT');
  addColumnIfMissing(db, 'menu_days', 'date', 'TEXT');
  addUniqueIndexIfMissing(db, 'recipes', 'name');
  addColumnIfMissing(db, 'recipes', 'servings', 'INTEGER DEFAULT 4');
  addColumnIfMissing(db, 'menu_days', 'recipe_id', 'INTEGER');
  addColumnIfMissing(db, 'recipe_ingredients', 'note', 'TEXT');
  addColumnIfMissing(db, 'recipe_ingredients', 'source_name', 'TEXT');
  addColumnIfMissing(db, 'recipes', 'status', "TEXT NOT NULL DEFAULT 'concept'");
  addColumnIfMissing(db, 'recipes', 'meal_type', 'TEXT');
  addColumnIfMissing(db, 'recipes', 'prep_time_minutes', 'INTEGER');
  addColumnIfMissing(db, 'recipes', 'cost_index', 'TEXT');
  // Own picture: bumped on every upload (cache key); a request asks the image
  // worker for a new one; an error parks the recipe until it is asked again
  addColumnIfMissing(db, 'recipes', 'image_version', 'INTEGER');
  addColumnIfMissing(db, 'recipes', 'image_requested_at', 'TEXT');
  addColumnIfMissing(db, 'recipes', 'image_error', 'TEXT');
  // Not a dinner (cake, dessert, bread, snack): kept, but not planned or held to the vegetable aim
  addColumnIfMissing(db, 'recipes', 'main_course', 'INTEGER NOT NULL DEFAULT 1');
  // A dinner that cannot carry the full vegetable aim (pizza night): at most once a week
  addColumnIfMissing(db, 'recipes', 'veg_exception', 'INTEGER NOT NULL DEFAULT 0');
  // Last vegetable top-up attempt (bulk job): when, what came of it, why
  addColumnIfMissing(db, 'recipes', 'veg_checked_at', 'TEXT');
  addColumnIfMissing(db, 'recipes', 'veg_outcome', 'TEXT');
  addColumnIfMissing(db, 'recipes', 'veg_note', 'TEXT');
  // What kind of dish (hoofdgerecht, bijgerecht, lunch, ontbijt, snack, toetje);
  // NULL until known. main_course stays in step with it (course = 'hoofdgerecht')
  addColumnIfMissing(db, 'recipes', 'course', "TEXT DEFAULT 'hoofdgerecht'");

  const userVersion = db.pragma('user_version', { simple: true }) as number;
  if (userVersion < 2) {
    seedAliases(db);
  }
  if (userVersion < 1) {
    migrateStructuredIngredients(db);
    db.pragma('user_version = 1');
  }
  if (userVersion < 2) {
    db.transaction(() => cleanupIngredients(db))();
    db.pragma('user_version = 2');
  }
  if (userVersion < 3) {
    db.transaction(() => {
      dedupeRecipeNames(db);
      backfillRecipeLibrary(db);
    })();
    db.pragma('user_version = 3');
  }
  if (userVersion < 4) {
    removeUniversalConversions(db);
    db.pragma('user_version = 4');
  }
  if (userVersion < 5) {
    // Re-derive the rows so each keeps the name as written (source_name),
    // which picks the right typical weight for varieties like "winterpeen"
    db.transaction(() => migrateStructuredIngredients(db))();
    db.pragma('user_version = 5');
  }
  if (userVersion < 6) {
    // Recipes already marked as no dinner are some other kind of dish, still to tell which
    db.prepare("UPDATE recipes SET course = NULL WHERE main_course = 0").run();
    db.pragma('user_version = 6');
  }
}

/**
 * One-time cleanup (v4): el, tl and ml now convert into each other the same
 * way for every ingredient, so a stored conversion between them is at best
 * redundant and at worst wrong ("1 tl = 0,5 el").
 */
export function removeUniversalConversions(db: Database.Database) {
  db.exec(`
    DELETE FROM ingredient_conversions
    WHERE unit IN ('el', 'tl', 'ml')
      AND ingredient_id IN (SELECT id FROM ingredients WHERE unit IN ('el', 'tl', 'ml'))
  `);
}

/**
 * One-time cleanup (v3): recipes are identified by name regardless of case
 * and surrounding spaces. Merge names that only differ that way, keeping the
 * approved one, else the most used, else the oldest; its menu days and usage
 * count move to the keeper. Then enforce it with a unique index.
 */
export function dedupeRecipeNames(db: Database.Database) {
  const groups = db.prepare(`
    SELECT lower(trim(name)) AS k FROM recipes GROUP BY k HAVING COUNT(*) > 1
  `).all() as Array<{ k: string }>;

  for (const { k } of groups) {
    const rows = db.prepare(`
      SELECT id, times_used FROM recipes WHERE lower(trim(name)) = ?
      ORDER BY status = 'goedgekeurd' DESC, status = 'concept' DESC, times_used DESC, id
    `).all(k) as Array<{ id: number; times_used: number }>;
    const [keeper, ...others] = rows;
    const otherIds = JSON.stringify(others.map((r) => r.id));
    db.prepare('UPDATE menu_days SET recipe_id = ? WHERE recipe_id IN (SELECT value FROM json_each(?))').run(keeper.id, otherIds);
    db.prepare('UPDATE recipes SET times_used = ? WHERE id = ?')
      .run(rows.reduce((sum, r) => sum + (r.times_used || 0), 0), keeper.id);
    db.prepare('DELETE FROM recipes WHERE id IN (SELECT value FROM json_each(?))').run(otherIds);
  }

  db.exec('UPDATE recipes SET name = trim(name) WHERE name != trim(name)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_recipes_name_nocase ON recipes(name COLLATE NOCASE)');
}

/**
 * One-time backfill (v3): recipes get the meal type, prep time and cost index
 * of the last menu day they were planned on, and recipes the family rated
 * "lekker" start out approved; everything else stays a concept.
 */
export function backfillRecipeLibrary(db: Database.Database) {
  for (const column of ['meal_type', 'prep_time_minutes', 'cost_index']) {
    db.exec(`
      UPDATE recipes SET ${column} = (
        SELECT md.${column} FROM menu_days md
        WHERE md.recipe_id = recipes.id AND md.${column} IS NOT NULL
        ORDER BY md.date DESC, md.id DESC
        LIMIT 1
      )
      WHERE ${column} IS NULL
    `);
  }

  db.exec(`
    UPDATE recipes SET status = 'goedgekeurd'
    WHERE status = 'concept' AND id IN (
      SELECT md.recipe_id FROM day_feedback df
      JOIN menu_days md ON md.id = df.day_id
      WHERE df.rating = 'lekker' AND md.recipe_id IS NOT NULL
    )
  `);
}

function seedAliases(db: Database.Database) {
  const insert = db.prepare('INSERT OR IGNORE INTO ingredient_aliases (alias, canonical) VALUES (?, ?)');
  for (const [alias, canonical] of Object.entries(SEED_ALIASES)) {
    insert.run(alias, canonical);
  }
}

/**
 * One-time cleanup (v2): re-derive every recipe's ingredient rows with the
 * annotation-stripping normalization, drop ingredients nothing refers to
 * anymore, and give each ingredient the unit it is most often used in.
 */
export function cleanupIngredients(db: Database.Database) {
  migrateStructuredIngredients(db);

  db.exec(`
    DELETE FROM ingredients
    WHERE id NOT IN (SELECT DISTINCT ingredient_id FROM recipe_ingredients)
  `);

  db.exec(`
    UPDATE ingredients SET unit = COALESCE((
      SELECT ri.unit FROM recipe_ingredients ri
      WHERE ri.ingredient_id = ingredients.id AND ri.amount IS NOT NULL
      GROUP BY ri.unit
      ORDER BY COUNT(*) DESC, ri.unit = 'g' DESC, ri.unit
      LIMIT 1
    ), unit)
  `);

  // Conversions learned from "(à 400g)" hints depend on the unit chosen above,
  // so learn them again now that the units are settled
  db.exec('DELETE FROM ingredient_conversions');
  migrateStructuredIngredients(db);
}

/**
 * One-time data migration: derive structured ingredient rows from the
 * recipe_data JSON of existing recipes, and link menu_days to recipes by name.
 */
export function migrateStructuredIngredients(db: Database.Database) {
  const recipes = db.prepare('SELECT id, recipe_data, servings FROM recipes').all() as Array<{
    id: number; recipe_data: string; servings: number | null;
  }>;

  for (const recipe of recipes) {
    let data: { ingredients?: Array<{ name: string; amount: string | number; unit: string; product_group: string }> };
    try {
      data = JSON.parse(recipe.recipe_data);
    } catch {
      continue; // Skip recipes with malformed JSON
    }
    if (!Array.isArray(data.ingredients)) continue;
    syncRecipeIngredients(db, recipe.id, data.ingredients, recipe.servings || 4);
  }

  db.exec(`
    UPDATE menu_days SET recipe_id = (
      SELECT r.id FROM recipes r WHERE r.name = menu_days.recipe_name
    )
    WHERE recipe_id IS NULL
  `);
}

function addUniqueIndexIfMissing(db: Database.Database, table: string, column: string) {
  const indexName = `idx_${table}_${column}_unique`;
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
  if (!existing) {
    // Remove duplicates first (keep lowest id)
    db.exec(`
      DELETE FROM ${table} WHERE rowid NOT IN (
        SELECT MIN(rowid) FROM ${table} GROUP BY ${column}
      )
    `);
    db.exec(`CREATE UNIQUE INDEX ${indexName} ON ${table}(${column})`);
  }
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
  }
}
