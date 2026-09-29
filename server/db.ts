import Database from 'better-sqlite3';
import path from 'path';
import { syncRecipeIngredients, SEED_ALIASES } from './services/ingredients.js';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'weekmenu.db');

let db: Database.Database;

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
