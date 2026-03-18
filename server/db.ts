import Database from 'better-sqlite3';
import path from 'path';

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
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined as unknown as Database.Database;
  }
}
