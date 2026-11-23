import type Database from 'better-sqlite3';
import {
  cleanName, conversionsFor, loadAliases, loadAliasesByCanonical, loadConversions, normalizeUnit, productCore, universalFactor,
} from './ingredients.js';
import { defaultFactor, WeightLookup } from './piece-weights.js';

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

/**
 * Whether two names are at most `max` edits apart (a letter more, less or
 * different). Gives up as soon as that is out of reach, which for two
 * unrelated names is after a letter or three.
 */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let least = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (curr[j] < least) least = curr[j];
    }
    // The least of a row never goes down in the next one
    if (least > max) return false;
    prev = curr;
  }
  return prev[b.length] <= max;
}

/** How many edits still make two names of this length the same product: a typo in a short name, two in a long one. */
const editsAllowed = (shortest: number) => (shortest >= 8 ? 2 : shortest >= 5 ? 1 : 0);

/** The heuristic below, with the product cores worked out by the caller. */
function alike(a: string, b: string, coreA: string, coreB: string): boolean {
  if (coreA === coreB) return true;
  const minLen = Math.min(a.length, b.length);
  if (!a.includes(' ') && !b.includes(' ') && minLen >= 4 && (a.endsWith(b) || b.endsWith(a))) return true;
  const max = editsAllowed(minLen);
  return max > 0 && withinEdits(a, b, max);
}

/**
 * Heuristic: names that are probably the same product (typo, plural,
 * "winterwortel"/"wortel", "kikkererwten"/"kikkererwten uit blik").
 */
export function looksLikeSameIngredient(a: string, b: string): boolean {
  return alike(a, b, productCore(a), productCore(b));
}

/** The letters a name has, as bits: names an edit or two apart differ in few of them. */
function lettersOf(name: string): number {
  let bits = 0;
  for (let i = 0; i < name.length; i++) bits |= 1 << (name.charCodeAt(i) % 31);
  return bits;
}

function bitsSet(n: number): number {
  let count = 0;
  for (let rest = n; rest !== 0; rest &= rest - 1) count++;
  return count;
}

/**
 * For every name, the others that are probably the same product, in the order
 * given. Every pair of names is looked at once, and most are told apart by
 * their length or their letters before any comparing letter by letter: with a
 * few thousand ingredients that is the difference between a moment and minutes.
 */
function likelyDuplicates(names: string[]): number[][] {
  const cores = names.map(productCore);
  const letters = names.map(lettersOf);
  const found: number[][] = names.map(() => []);
  for (let i = 0; i < names.length; i++) {
    const a = names[i];
    for (let j = i + 1; j < names.length; j++) {
      const b = names[j];
      let same = cores[i] === cores[j];
      if (!same) {
        const minLen = Math.min(a.length, b.length);
        if (minLen >= 4 && (a.endsWith(b) || b.endsWith(a)) && !a.includes(' ') && !b.includes(' ')) same = true;
        else {
          const max = editsAllowed(minLen);
          // An edit changes which letters a name has by two at most
          same = max > 0 && Math.abs(a.length - b.length) <= max && bitsSet(letters[i] ^ letters[j]) <= 2 * max && withinEdits(a, b, max);
        }
      }
      if (same) {
        found[i].push(j);
        found[j].push(i);
      }
    }
  }
  return found;
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
  const duplicates = likelyDuplicates(ingredients.map((i) => i.name));
  const unitsOf = new Map<number, typeof unitRows>();
  for (const row of unitRows) unitsOf.set(row.ingredient_id, [...(unitsOf.get(row.ingredient_id) ?? []), row]);

  return ingredients.map((ing, index) => {
    const convs = conversions.get(ing.id) ?? new Map<string, number>();
    const aliases = aliasRows.filter((a) => a.canonical === ing.name).map((a) => a.alias);
    const used = (unitsOf.get(ing.id) ?? [])
      .map((u) => {
        if (u.unit === ing.unit) return { unit: u.unit, count: u.count, factor: 1 };
        // Universal conversions win over anything stored for el/tl/ml
        const universal = universalFactor(u.unit, ing.unit);
        if (universal !== undefined) return { unit: u.unit, count: u.count, factor: universal, builtin: true };
        const own = convs.get(u.unit);
        if (own !== undefined) return { unit: u.unit, count: u.count, factor: own };
        const standard = defaultFactor({ name: ing.name, aliases }, u.unit, ing.unit);
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
      aliases,
      needs_attention: used.some((u) => u.count > 0 && u.factor === null),
      merge_suggestions: duplicates[index].map((other) => ingredients[other].id),
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
  const product: WeightLookup = { name: ing.name, aliases: loadAliasesByCanonical(db).get(ing.name) };
  // 1 new unit = newFactor x old unit: universal (el/tl/ml), stored, or a typical piece weight
  const newFactor = universalFactor(unit, ing.unit) ?? convs.get(unit) ?? defaultFactor(product, unit, ing.unit);
  db.prepare('DELETE FROM ingredient_conversions WHERE ingredient_id = ?').run(id);
  db.prepare('UPDATE ingredients SET unit = ? WHERE id = ?').run(unit, id);

  if (newFactor === undefined) return convs.size > 0;

  // Universal conversions and typical piece weights hold anyway and are not stored
  const insert = db.prepare('INSERT INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, ?, ?)');
  const rebased = new Map(convs).set(ing.unit, 1);
  for (const [u, f] of rebased) {
    if (u !== unit && !holdsAnyway(product, u, unit, f / newFactor)) insert.run(id, u, f / newFactor);
  }
  return false;
}

/** Whether a conversion needs no storing: universal (el/tl/ml), or equal to the typical piece weight. */
function holdsAnyway(product: WeightLookup, unit: string, baseUnit: string, factor: number): boolean {
  if (universalFactor(unit, baseUnit) !== undefined) return true;
  const standard = defaultFactor(product, unit, baseUnit);
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
  const aliasesOf = loadAliasesByCanonical(db);
  const targetProduct: WeightLookup = { name: target.name, aliases: aliasesOf.get(target.name) };
  const sourceProduct: WeightLookup = { name: source.name, aliases: aliasesOf.get(source.name) };
  const sourceConvs = conversionsFor(all.get(sourceId), source.unit).set(source.unit, 1);
  const targetConvs = conversionsFor(all.get(targetId), target.unit);

  // How many target units is 1 source unit?
  const k = source.unit === target.unit
    ? 1
    : universalFactor(source.unit, target.unit)
      ?? targetConvs.get(source.unit)
      ?? (sourceConvs.has(target.unit) ? 1 / sourceConvs.get(target.unit)! : undefined)
      ?? defaultFactor(targetProduct, source.unit, target.unit)
      ?? defaultFactor(sourceProduct, source.unit, target.unit);

  if (k !== undefined) {
    const insert = db.prepare('INSERT OR IGNORE INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, ?, ?)');
    for (const [unit, factor] of sourceConvs) {
      // Universal conversions and typical piece weights hold anyway and are not stored
      if (unit !== target.unit && !holdsAnyway(targetProduct, unit, target.unit, factor * k)) insert.run(targetId, unit, factor * k);
    }
  }

  db.prepare('UPDATE recipe_ingredients SET ingredient_id = ? WHERE ingredient_id = ?').run(targetId, sourceId);
  db.prepare('DELETE FROM ingredients WHERE id = ?').run(sourceId);
  redirectAliases(db, source.name, target.name);

  return recipeIds;
}
