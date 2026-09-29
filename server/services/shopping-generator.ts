import type Database from 'better-sqlite3';
import { getDb } from '../db.js';
import {
  PANTRY_GROUPS,
  PERISHABLE_GROUPS,
  normalizeIngredient,
  formatQuantity,
  convertToBase,
  loadAliases,
  loadConversions,
  RawIngredient,
} from './ingredients.js';

// How many portions the household eats per meal; recipes scale from their
// own servings to this. 2 volwassenen + 2 kinderen = 4.
const HOUSEHOLD_PORTIONS = parseFloat(process.env.HOUSEHOLD_PORTIONS || '4');

interface AggregatedIngredient {
  name: string;
  product_group: string;
  days: string[];
  byUnit: Map<string, number>;
  rawTexts: string[];
}

interface StructuredRow {
  day_name: string;
  ingredient_id: number;
  base_unit: string;
  ingredient_name: string;
  product_group: string;
  amount: number | null;
  unit: string;
  raw_text: string | null;
  servings: number;
}

interface LegacyDay {
  day_name: string;
  recipe_data: string;
}

/**
 * Collect all ingredients for the non-completed days of a menu, aggregated
 * per canonical ingredient. Days linked to a recipe read from the structured
 * recipe_ingredients rows (source of truth, so fixes in the recipe library
 * propagate). Unlinked legacy days fall back to parsing their recipe_data
 * snapshot through the same normalization pipeline.
 */
function collectMenuIngredients(db: Database.Database, menuId: number): Map<string, AggregatedIngredient> {
  const items = new Map<string, AggregatedIngredient>();

  const add = (dayName: string, name: string, group: string, amount: number | null, unit: string, rawText: string | null, scale: number) => {
    if (!items.has(name)) {
      items.set(name, { name, product_group: group, days: [], byUnit: new Map(), rawTexts: [] });
    }
    const entry = items.get(name)!;
    if (!entry.days.includes(dayName)) entry.days.push(dayName);
    if (amount !== null) {
      entry.byUnit.set(unit, (entry.byUnit.get(unit) || 0) + amount * scale);
    } else if (rawText && !entry.rawTexts.includes(rawText)) {
      entry.rawTexts.push(rawText);
    }
  };

  const structured = db.prepare(`
    SELECT md.day_name, i.id AS ingredient_id, i.unit AS base_unit,
           i.name AS ingredient_name, i.product_group,
           ri.amount, ri.unit, ri.raw_text, COALESCE(r.servings, 4) AS servings
    FROM menu_days md
    JOIN recipes r ON md.recipe_id = r.id
    JOIN recipe_ingredients ri ON ri.recipe_id = r.id
    JOIN ingredients i ON ri.ingredient_id = i.id
    WHERE md.menu_id = ? AND md.status != 'completed'
    ORDER BY md.date, md.day_of_week
  `).all(menuId) as StructuredRow[];

  const conversions = loadConversions(db);
  for (const row of structured) {
    const scale = HOUSEHOLD_PORTIONS / (row.servings || 4);
    // Express the amount in the ingredient's own unit when a conversion is
    // known, so "1 blik" and "240 g" kikkererwten add up to one number
    let amount = row.amount;
    let unit = row.unit;
    if (amount !== null) {
      const converted = convertToBase(amount, unit, row.base_unit, conversions.get(row.ingredient_id));
      if (converted !== null) {
        amount = converted;
        unit = row.base_unit;
      }
    }
    add(row.day_name, row.ingredient_name, row.product_group, amount, unit, row.raw_text, scale);
  }

  const legacyDays = db.prepare(`
    SELECT day_name, recipe_data
    FROM menu_days
    WHERE menu_id = ? AND status != 'completed' AND (
      recipe_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = menu_days.recipe_id)
    )
    ORDER BY date, day_of_week
  `).all(menuId) as LegacyDay[];

  const aliases = loadAliases(db);
  for (const day of legacyDays) {
    let recipe: { ingredients?: RawIngredient[] };
    try {
      recipe = JSON.parse(day.recipe_data);
    } catch {
      continue; // Skip days with malformed recipe data
    }
    if (!Array.isArray(recipe.ingredients)) continue;

    for (const raw of recipe.ingredients) {
      const norm = normalizeIngredient(raw, aliases);
      if (!norm.name) continue;
      add(day.day_name, norm.name, norm.product_group, norm.amount, norm.unit, norm.raw_text, 1);
    }
  }

  return items;
}

function quantityFor(entry: AggregatedIngredient): string {
  if (entry.byUnit.size > 0) return formatQuantity(entry.byUnit);
  return entry.rawTexts.join(', ');
}

/**
 * (Re)build the shopping list for a menu from the planned recipes.
 * Checked state survives regeneration, matched on item name.
 */
export function generateShoppingList(menuId: number): void {
  const db = getDb();
  const items = collectMenuIngredients(db, menuId);

  const checkedNames = new Set(
    (db.prepare('SELECT item_name FROM shopping_items WHERE menu_id = ? AND checked = 1').all(menuId) as Array<{ item_name: string }>)
      .map((r) => r.item_name.toLowerCase())
  );

  const insert = db.prepare(`
    INSERT INTO shopping_items (menu_id, product_group, item_name, quantity, for_days, is_perishable, checked)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const replaceAll = db.transaction(() => {
    db.prepare('DELETE FROM shopping_items WHERE menu_id = ?').run(menuId);
    for (const entry of items.values()) {
      insert.run(
        menuId,
        entry.product_group,
        entry.name,
        quantityFor(entry),
        JSON.stringify(entry.days),
        PERISHABLE_GROUPS.includes(entry.product_group) ? 1 : 0,
        checkedNames.has(entry.name.toLowerCase()) ? 1 : 0,
      );
    }
  });
  replaceAll();
}

/**
 * (Re)build the pantry check (staples needed for remaining days).
 * The have_it state survives regeneration, matched on item name.
 */
export function generatePantryCheck(menuId: number): void {
  const db = getDb();
  const items = collectMenuIngredients(db, menuId);

  const haveNames = new Set(
    (db.prepare('SELECT item_name FROM pantry_check WHERE menu_id = ? AND have_it = 1').all(menuId) as Array<{ item_name: string }>)
      .map((r) => r.item_name.toLowerCase())
  );

  const insert = db.prepare(
    'INSERT INTO pantry_check (menu_id, item_name, quantity, needed_for_days, have_it) VALUES (?, ?, ?, ?, ?)'
  );

  const replaceAll = db.transaction(() => {
    db.prepare('DELETE FROM pantry_check WHERE menu_id = ?').run(menuId);
    for (const entry of items.values()) {
      if (!PANTRY_GROUPS.includes(entry.product_group)) continue;
      insert.run(
        menuId,
        entry.name,
        quantityFor(entry),
        JSON.stringify(entry.days),
        haveNames.has(entry.name.toLowerCase()) ? 1 : 0,
      );
    }
  });
  replaceAll();
}

/** Recompute shopping list + pantry check of all active menus, optionally only those using one of the given recipes. */
export function regenerateActiveMenus(recipeIds?: number[]): void {
  const db = getDb();
  const menus = (recipeIds
    ? db.prepare(`
        SELECT DISTINCT m.id FROM menus m
        JOIN menu_days md ON md.menu_id = m.id
        WHERE m.status = 'active' AND md.recipe_id IN (SELECT value FROM json_each(?))
      `).all(JSON.stringify(recipeIds))
    : db.prepare("SELECT id FROM menus WHERE status = 'active'").all()
  ) as Array<{ id: number }>;

  for (const menu of menus) {
    try {
      generateShoppingList(menu.id);
      generatePantryCheck(menu.id);
    } catch (err) {
      console.error(`Regeneration for menu ${menu.id} failed:`, err);
    }
  }
}
