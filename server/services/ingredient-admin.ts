import type Database from 'better-sqlite3';
import { cleanName, conversionsFor, loadAliases, loadConversions, normalizeUnit, productCore, universalFactor } from './ingredients.js';
import { defaultFactor } from './piece-weights.js';

export class IngredientError extends Error {
  constructor(message: string, public status: number = 400, public conflictId?: number) {
    super(message);
  }
}

interface IngredientRow {
  id: number;
  name: string;
  unit: string;
  product_group: string;
}

export interface IngredientOverview extends IngredientRow {
  recipe_count: number;
  /**
   * builtin: a universal conversion (el/tl/ml), not stored and not editable.
   * standard: a typical piece weight for a known vegetable, not stored; setting
   * a conversion overrides it.
   */
  units_used: Array<{ unit: string; count: number; factor: number | null; builtin?: boolean; standard?: boolean }>;
  aliases: string[];
  /** Used in a unit that cannot be converted to its own unit, so totals get split. */
  needs_attention: boolean;
  merge_suggestions: number[];
}

function getIngredient(db: Database.Database, id: number): IngredientRow {
  const row = db.prepare('SELECT id, name, unit, product_group FROM ingredients WHERE id = ?').get(id) as IngredientRow | undefined;
  if (!row) throw new IngredientError('Ingrediënt niet gevonden', 404);
  return row;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Heuristic: names that are probably the same product (typo, plural,
 * "winterwortel"/"wortel", "kikkererwten"/"kikkererwten uit blik").
 */
export function looksLikeSameIngredient(a: string, b: string): boolean {
  if (productCore(a) === productCore(b)) return true;
  const minLen = Math.min(a.length, b.length);
  if (!a.includes(' ') && !b.includes(' ') && minLen >= 4 && (a.endsWith(b) || b.endsWith(a))) return true;
  const dist = levenshtein(a, b);
  return (minLen >= 5 && dist <= 1) || (minLen >= 8 && dist <= 2);
}

export function listIngredients(db: Database.Database): IngredientOverview[] {
  const ingredients = db.prepare(`
    SELECT i.id, i.name, i.unit, i.product_group, COUNT(DISTINCT ri.recipe_id) AS recipe_count
    FROM ingredients i
    LEFT JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
    GROUP BY i.id
    ORDER BY i.name
  `).all() as Array<IngredientRow & { recipe_count: number }>;

  const unitRows = db.prepare(`
    SELECT ingredient_id, unit, COUNT(*) AS count FROM recipe_ingredients
    WHERE amount IS NOT NULL
    GROUP BY ingredient_id, unit
  `).all() as Array<{ ingredient_id: number; unit: string; count: number }>;

  const aliasRows = db.prepare('SELECT alias, canonical FROM ingredient_aliases ORDER BY alias').all() as Array<{ alias: string; canonical: string }>;
  const conversions = loadConversions(db);

  return ingredients.map((ing) => {
    const convs = conversions.get(ing.id) ?? new Map<string, number>();
    const used = unitRows
      .filter((u) => u.ingredient_id === ing.id)
      .map((u) => {
        if (u.unit === ing.unit) return { unit: u.unit, count: u.count, factor: 1 };
        // Universal conversions win over anything stored for el/tl/ml
        const universal = universalFactor(u.unit, ing.unit);
        if (universal !== undefined) return { unit: u.unit, count: u.count, factor: universal, builtin: true };
        const own = convs.get(u.unit);
        if (own !== undefined) return { unit: u.unit, count: u.count, factor: own };
        const standard = defaultFactor(ing.name, u.unit, ing.unit);
        return standard !== undefined
          ? { unit: u.unit, count: u.count, factor: standard, standard: true }
          : { unit: u.unit, count: u.count, factor: null };
      });
    // Also show conversions for units no recipe currently uses
    for (const [unit, factor] of convs) {
      if (!used.some((u) => u.unit === unit) && universalFactor(unit, ing.unit) === undefined) {
        used.push({ unit, count: 0, factor });
      }
    }

    return {
      ...ing,
      units_used: used,
      aliases: aliasRows.filter((a) => a.canonical === ing.name).map((a) => a.alias),
      needs_attention: used.some((u) => u.count > 0 && u.factor === null),
      merge_suggestions: ingredients
        .filter((other) => other.id !== ing.id && looksLikeSameIngredient(ing.name, other.name))
        .map((other) => other.id),
    };
  });
}

/** Rename an ingredient; the old name becomes an alias so future imports resolve to it. */
export function renameIngredient(db: Database.Database, id: number, rawName: string): void {
  const ing = getIngredient(db, id);
  const name = cleanName(rawName).name;
  if (!name) throw new IngredientError('Naam mag niet leeg zijn');
  if (name === ing.name) return;

  const clash = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(name) as { id: number } | undefined;
  if (clash) throw new IngredientError(`"${name}" bestaat al — voeg ze samen`, 409, clash.id);

  // The new name may already be an alias: imports of it would keep going to
  // that alias's ingredient instead of this one
  const aliasTarget = loadAliases(db).get(name);
  if (aliasTarget && aliasTarget !== ing.name) {
    const owner = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(aliasTarget) as { id: number } | undefined;
    if (owner) {
      throw new IngredientError(`"${name}" is al een andere naam voor "${aliasTarget}" — voeg ze samen`, 409, owner.id);
    }
    // Alias to an ingredient that no longer exists: this ingredient takes the name over
    db.prepare('DELETE FROM ingredient_aliases WHERE alias = ?').run(name);
  }

  db.prepare('UPDATE ingredients SET name = ? WHERE id = ?').run(name, id);
  redirectAliases(db, ing.name, name);
}

function redirectAliases(db: Database.Database, from: string, to: string): void {
  db.prepare('UPDATE ingredient_aliases SET canonical = ? WHERE canonical = ?').run(to, from);
  db.prepare('INSERT OR REPLACE INTO ingredient_aliases (alias, canonical) VALUES (?, ?)').run(from, to);
  db.prepare('DELETE FROM ingredient_aliases WHERE alias = canonical').run();
}

/**
 * Change the unit an ingredient is shopped in. Existing conversions are
 * rebased onto the new unit when possible; otherwise they are dropped.
 * Returns whether conversions had to be dropped.
 */
export function changeIngredientUnit(db: Database.Database, id: number, rawUnit: string): boolean {
  const ing = getIngredient(db, id);
  const unit = normalizeUnit(rawUnit).unit;
  if (!unit) throw new IngredientError('Eenheid mag niet leeg zijn');
  if (unit === ing.unit) return false;

  const convs = conversionsFor(loadConversions(db).get(id), ing.unit);
  // 1 new unit = newFactor x old unit, from a universal (el/tl/ml) or a stored conversion
  const newFactor = universalFactor(unit, ing.unit) ?? convs.get(unit) ?? defaultFactor(ing.name, unit, ing.unit);
  db.prepare('DELETE FROM ingredient_conversions WHERE ingredient_id = ?').run(id);
  db.prepare('UPDATE ingredients SET unit = ? WHERE id = ?').run(unit, id);

  if (newFactor === undefined) return convs.size > 0;

  // Universal conversions and typical piece weights hold anyway and are not stored
  const insert = db.prepare('INSERT INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, ?, ?)');
  const rebased = new Map(convs).set(ing.unit, 1);
  for (const [u, f] of rebased) {
    if (u !== unit && !holdsAnyway(ing.name, u, unit, f / newFactor)) insert.run(id, u, f / newFactor);
  }
  return false;
}

/** Whether a conversion needs no storing: universal (el/tl/ml), or equal to the typical piece weight. */
function holdsAnyway(name: string, unit: string, baseUnit: string, factor: number): boolean {
  if (universalFactor(unit, baseUnit) !== undefined) return true;
  const standard = defaultFactor(name, unit, baseUnit);
  return standard !== undefined && Math.abs(standard - factor) <= 1e-9 * Math.max(1, Math.abs(standard));
}

export function setConversion(db: Database.Database, id: number, rawUnit: string, factor: number): void {
  const ing = getIngredient(db, id);
  const unit = normalizeUnit(rawUnit).unit;
  if (!unit) throw new IngredientError('Eenheid mag niet leeg zijn');
  if (unit === ing.unit) throw new IngredientError('Dit is al de eenheid van het ingrediënt');
  if (!Number.isFinite(factor) || factor <= 0) throw new IngredientError('Omrekenfactor moet een positief getal zijn');
  if (universalFactor(unit, ing.unit) !== undefined) {
    throw new IngredientError(`${unit} en ${ing.unit} rekenen al vast om (1 el = 3 tl = 15 ml)`);
  }
  db.prepare(`
    INSERT INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, ?, ?)
    ON CONFLICT(ingredient_id, unit) DO UPDATE SET factor = excluded.factor
  `).run(id, unit, factor);
}

export function deleteConversion(db: Database.Database, id: number, unit: string): void {
  getIngredient(db, id);
  db.prepare('DELETE FROM ingredient_conversions WHERE ingredient_id = ? AND unit = ?').run(id, unit);
}

/**
 * Merge `sourceId` into `targetId`: recipe rows move over, conversions carry
 * across where the units can be related, and the source name becomes an alias.
 * Returns the ids of recipes that used the source.
 */
export function mergeIngredients(db: Database.Database, sourceId: number, targetId: number): number[] {
  if (sourceId === targetId) throw new IngredientError('Kan een ingrediënt niet met zichzelf samenvoegen');
  const source = getIngredient(db, sourceId);
  const target = getIngredient(db, targetId);

  const recipeIds = (db.prepare('SELECT DISTINCT recipe_id FROM recipe_ingredients WHERE ingredient_id = ?').all(sourceId) as Array<{ recipe_id: number }>)
    .map((r) => r.recipe_id);

  const all = loadConversions(db);
  const sourceConvs = conversionsFor(all.get(sourceId), source.unit).set(source.unit, 1);
  const targetConvs = conversionsFor(all.get(targetId), target.unit);

  // How many target units is 1 source unit?
  const k = source.unit === target.unit
    ? 1
    : universalFactor(source.unit, target.unit)
      ?? targetConvs.get(source.unit)
      ?? (sourceConvs.has(target.unit) ? 1 / sourceConvs.get(target.unit)! : undefined)
      ?? defaultFactor(target.name, source.unit, target.unit)
      ?? defaultFactor(source.name, source.unit, target.unit);

  if (k !== undefined) {
    const insert = db.prepare('INSERT OR IGNORE INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, ?, ?)');
    for (const [unit, factor] of sourceConvs) {
      // Universal conversions and typical piece weights hold anyway and are not stored
      if (unit !== target.unit && !holdsAnyway(target.name, unit, target.unit, factor * k)) insert.run(targetId, unit, factor * k);
    }
  }

  db.prepare('UPDATE recipe_ingredients SET ingredient_id = ? WHERE ingredient_id = ?').run(targetId, sourceId);
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(sourceId);
  redirectAliases(db, source.name, target.name);

  return recipeIds;
}
