import type Database from 'better-sqlite3';
import {
  convertToBase, findIngredient, loadAliases, loadAliasesByCanonical, loadConversions, normalizeIngredient,
} from './ingredients.js';
import { defaultFactor, WeightLookup } from './piece-weights.js';

/**
 * Grams of vegetables per serving, the family's main yardstick for a dinner
 * (the Schijf van Vijf asks 250 g per adult, the family aims at 350 g).
 * Computed from the structured ingredients, so it follows every edit.
 */

/** The family's aim per adult serving; at least the minimum for an exception (pizza night). */
export const VEGETABLE_TARGET = 350;
export const VEGETABLE_MINIMUM = 250;

// Filed under "groenten" in the library but not vegetables in the Schijf van
// Vijf: potatoes and pulses (protein), olives, citrus, aromatics and herbs
const NOT_VEGETABLE = new RegExp([
  'aardappel', 'krieltje', 'friet', 'kastanje', 'olijf', 'olijven', 'citroen', 'limoen',
  'knoflook', 'gember', 'chili', 'chilli', 'peper', 'peterselie', 'basilicum', 'koriander', 'dille',
  'munt', 'bieslook', 'tijm', 'rozemarijn', 'salie', 'oregano',
  'poeder', 'gerookte paprika', 'puree', 'pesto', 'ketchup', 'bouillon', 'tapenade',
].join('|'));
// Beans that are eaten as a vegetable; other beans, chickpeas and lentils are pulses
const GREEN_BEANS = /sperzie|slabo|snijbo|tuinbo|haricot/;
const PULSES = /bonen|boon\b|kikkererwt|linze|spliterwt|edamame/;
// Vegetables filed elsewhere: tinned tomatoes, passata, frozen vegetables
const VEGETABLE_ELSEWHERE = /tomat|passata|erwt|spinazie|groente|broccoli|wortel|bleekselderij|paprika|ma[iï]s|sperzie|bloemkool|courgette|\bui\b/;

/** Whether an ingredient counts as vegetable, by its library name and product group. */
export function isVegetable(name: string, productGroup: string): boolean {
  const n = name.toLowerCase();
  if (NOT_VEGETABLE.test(n)) return false;
  if (PULSES.test(n) && !GREEN_BEANS.test(n)) return false;
  return productGroup === 'groenten' || VEGETABLE_ELSEWHERE.test(n);
}

interface Weighable {
  amount: number;
  unit: string;
  product: WeightLookup;
  /** The ingredient's own unit, when it is in the library. */
  base?: string;
  conversions?: Map<string, number>;
}

/** Grams of an amount, through the ingredient's conversions and typical weights; null if it cannot be weighed. */
function grams({ amount, unit, product, base, conversions }: Weighable): number | null {
  // Vegetables measured in ml are sauces like passata: as heavy as water
  if (unit === 'g' || unit === 'ml') return amount;
  if (base === undefined) {
    const factor = defaultFactor(product, unit, 'g');
    return factor === undefined ? null : amount * factor;
  }
  const inBase = convertToBase(amount, unit, base, conversions, product);
  if (inBase === null) return null;
  if (base === 'g' || base === 'ml') return inBase;
  const perGram = conversions?.get('g'); // 1 g = perGram base
  if (perGram) return inBase / perGram;
  const factor = defaultFactor(product, base, 'g');
  return factor === undefined ? null : inBase * factor;
}

export interface VegetableScore {
  /** Grams of vegetables per serving, rounded; counts only what could be weighed. */
  per_serving: number;
  /** Vegetable lines that could not be weighed ("1 krop ijsbergsla of little gem"). */
  unweighed: string[];
}

function score(lines: Array<Weighable & { label: string }>, servings: number): VegetableScore {
  let total = 0;
  const unweighed: string[] = [];
  for (const line of lines) {
    const g = grams(line);
    if (g === null) unweighed.push(line.label);
    else total += g;
  }
  return { per_serving: Math.round(total / Math.max(1, servings)), unweighed };
}

/** The vegetable score of every recipe in the library (or of `ids`), by recipe id. */
export function vegetableScores(db: Database.Database, ids?: number[]): Map<number, VegetableScore> {
  const conversions = loadConversions(db);
  const aliasesOf = loadAliasesByCanonical(db);
  // All recipes, or those whose id is in the JSON list
  const only = ids ? 'IN (SELECT value FROM json_each(?))' : 'IS NOT NULL';
  const params = ids ? [JSON.stringify(ids)] : [];
  const recipes = db.prepare(`SELECT id, recipe_data FROM recipes WHERE id ${only}`).all(...params) as Array<{ id: number; recipe_data: string }>;
  const rows = db.prepare(`
    SELECT ri.recipe_id, ri.amount, ri.unit, ri.source_name, i.id AS ingredient_id, i.name, i.unit AS base, i.product_group
    FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.amount IS NOT NULL AND ri.recipe_id ${only}
  `).all(...params) as Array<{
    recipe_id: number; amount: number; unit: string; source_name: string | null;
    ingredient_id: number; name: string; base: string; product_group: string;
  }>;

  const vegetablesOf = new Map<number, Array<Weighable & { label: string }>>();
  for (const r of rows) {
    if (!isVegetable(r.name, r.product_group)) continue;
    const lines = vegetablesOf.get(r.recipe_id) ?? [];
    lines.push({
      amount: r.amount, unit: r.unit, base: r.base, conversions: conversions.get(r.ingredient_id),
      product: { variant: r.source_name, name: r.name, aliases: aliasesOf.get(r.name) },
      label: `${r.amount} ${r.unit} ${r.name}`.trim(),
    });
    vegetablesOf.set(r.recipe_id, lines);
  }

  const result = new Map<number, VegetableScore>();
  for (const recipe of recipes) {
    let servings = 4;
    try { servings = Number(JSON.parse(recipe.recipe_data).servings) || 4; } catch { /* malformed data */ }
    result.set(recipe.id, score(vegetablesOf.get(recipe.id) ?? [], servings));
  }
  return result;
}

/**
 * The score of ingredients that are not saved yet, such as a proposed change:
 * named and weighed the way saving would, new ingredients by their group.
 */
export function vegetableScoreOf(
  db: Database.Database,
  ingredients: Array<{ name: string; amount: number | string | null; unit: string; product_group: string }>,
  servings: number,
): VegetableScore {
  const aliases = loadAliases(db);
  const aliasesOf = loadAliasesByCanonical(db);
  const conversions = loadConversions(db);
  const groupOf = db.prepare('SELECT product_group FROM ingredients WHERE id = ?');
  const lines = [];
  for (const raw of ingredients) {
    const norm = normalizeIngredient(raw, aliases);
    if (!norm.name || norm.amount === null) continue;
    const known = findIngredient(db, norm.name);
    const group = known ? (groupOf.get(known.id) as { product_group: string }).product_group : norm.product_group;
    const name = known?.name ?? norm.name;
    if (!isVegetable(name, group)) continue;
    lines.push({
      amount: norm.amount, unit: norm.unit, base: known?.unit,
      conversions: known ? conversions.get(known.id) : undefined,
      product: { variant: norm.variant, name, aliases: aliasesOf.get(name) },
      label: `${norm.amount} ${norm.unit} ${name}`.trim(),
    });
  }
  return score(lines, servings);
}
