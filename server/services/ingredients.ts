import type Database from 'better-sqlite3';

// Product groups whose items belong in the pantry check (staples you likely have)
export const PANTRY_GROUPS = ['kruiden', 'droogwaren', 'olie', 'sauzen', 'zuivel'];

// Product groups that are perishable on the shopping list
export const PERISHABLE_GROUPS = ['groenten', 'fruit', 'vis', 'vlees', 'zuivel', 'brood'];

// Units that represent countable things: round up to whole numbers when shopping
const COUNT_UNITS = new Set(['stuks', 'teen', 'blik', 'pot', 'zak', 'bos', 'plak']);

// Maps unit spelling variants to a canonical unit, with a multiplication factor
// so amounts in larger units aggregate with the canonical one (kg -> g).
const UNIT_MAP: Record<string, { unit: string; factor: number }> = {
  g: { unit: 'g', factor: 1 },
  gr: { unit: 'g', factor: 1 },
  gram: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
  kilo: { unit: 'g', factor: 1000 },
  kilogram: { unit: 'g', factor: 1000 },
  ml: { unit: 'ml', factor: 1 },
  milliliter: { unit: 'ml', factor: 1 },
  dl: { unit: 'ml', factor: 100 },
  l: { unit: 'ml', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 },
  el: { unit: 'el', factor: 1 },
  eetlepel: { unit: 'el', factor: 1 },
  eetlepels: { unit: 'el', factor: 1 },
  tl: { unit: 'tl', factor: 1 },
  theelepel: { unit: 'tl', factor: 1 },
  theelepels: { unit: 'tl', factor: 1 },
  stuk: { unit: 'stuks', factor: 1 },
  stuks: { unit: 'stuks', factor: 1 },
  st: { unit: 'stuks', factor: 1 },
  x: { unit: 'stuks', factor: 1 },
  teen: { unit: 'teen', factor: 1 },
  tenen: { unit: 'teen', factor: 1 },
  teentje: { unit: 'teen', factor: 1 },
  teentjes: { unit: 'teen', factor: 1 },
  blik: { unit: 'blik', factor: 1 },
  blikje: { unit: 'blik', factor: 1 },
  blikjes: { unit: 'blik', factor: 1 },
  pot: { unit: 'pot', factor: 1 },
  potje: { unit: 'pot', factor: 1 },
  potjes: { unit: 'pot', factor: 1 },
  zak: { unit: 'zak', factor: 1 },
  zakje: { unit: 'zak', factor: 1 },
  zakjes: { unit: 'zak', factor: 1 },
  bos: { unit: 'bos', factor: 1 },
  bosje: { unit: 'bos', factor: 1 },
  bosjes: { unit: 'bos', factor: 1 },
  plak: { unit: 'plak', factor: 1 },
  plakken: { unit: 'plak', factor: 1 },
  plakje: { unit: 'plak', factor: 1 },
  plakjes: { unit: 'plak', factor: 1 },
  snuf: { unit: 'snufje', factor: 1 },
  snufje: { unit: 'snufje', factor: 1 },
  snufjes: { unit: 'snufje', factor: 1 },
  mespunt: { unit: 'mespunt', factor: 1 },
  takje: { unit: 'takje', factor: 1 },
  takjes: { unit: 'takje', factor: 1 },
};

// Exact-match synonyms so the same ingredient aggregates under one canonical name.
// Deliberately a dictionary, not generic plural-stripping: Dutch plurals are too
// irregular to fold automatically (linzen, kersen, ...).
const NAME_SYNONYMS: Record<string, string> = {
  uien: 'ui',
  uitje: 'ui',
  uitjes: 'ui',
  'rode uien': 'rode ui',
  sjalotten: 'sjalot',
  sjalotje: 'sjalot',
  sjalotjes: 'sjalot',
  eieren: 'ei',
  tomaten: 'tomaat',
  cherrytomaten: 'cherrytomaat',
  cherrytomaatjes: 'cherrytomaat',
  "paprika's": 'paprika',
  paprikas: 'paprika',
  wortels: 'wortel',
  wortelen: 'wortel',
  winterpeen: 'wortel',
  aardappels: 'aardappel',
  aardappelen: 'aardappel',
  courgettes: 'courgette',
  champignons: 'champignon',
  knoflookteen: 'knoflook',
  knoflooktenen: 'knoflook',
  knoflookteentje: 'knoflook',
  knoflookteentjes: 'knoflook',
  'teentje knoflook': 'knoflook',
  'teentjes knoflook': 'knoflook',
  citroenen: 'citroen',
  limoenen: 'limoen',
  bosuitjes: 'bosui',
  bosuien: 'bosui',
  'lente-ui': 'bosui',
  'lente-uitjes': 'bosui',
  lenteui: 'bosui',
  preien: 'prei',
  appels: 'appel',
  appelen: 'appel',
  bananen: 'banaan',
  wraps: 'wrap',
  tortilla: 'wrap',
  "tortilla's": 'wrap',
  tortillas: 'wrap',
};

export function normalizeName(name: string): string {
  const cleaned = name.toLowerCase().trim().replace(/\s+/g, ' ');
  return NAME_SYNONYMS[cleaned] || cleaned;
}

export function normalizeUnit(unit: string): { unit: string; factor: number } {
  const cleaned = unit.toLowerCase().trim().replace(/\.$/, '');
  return UNIT_MAP[cleaned] || { unit: cleaned, factor: 1 };
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅛': 0.125,
};

/**
 * Parse an amount that may come in as a number or a free-text string
 * ("400", "0,5", "½", "1/2", "1-2"). Ranges resolve to the upper bound
 * (better to buy slightly too much than too little). Returns null for
 * non-numeric text like "naar smaak".
 */
export function parseAmount(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined) return null;
  if (typeof amount === 'number') return Number.isFinite(amount) ? amount : null;

  let s = amount.trim().replace(/,/g, '.');
  if (!s) return null;

  // Unicode fractions, optionally with a leading integer ("1½")
  const fracMatch = s.match(/^(\d+)?\s*([½⅓⅔¼¾⅛])$/);
  if (fracMatch) {
    return (fracMatch[1] ? parseInt(fracMatch[1], 10) : 0) + UNICODE_FRACTIONS[fracMatch[2]];
  }

  // Plain fractions ("1/2", "3/4")
  const slashMatch = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slashMatch) {
    const denom = parseInt(slashMatch[2], 10);
    return denom === 0 ? null : parseInt(slashMatch[1], 10) / denom;
  }

  // Ranges ("1-2", "1 à 2", "1 a 2") -> upper bound
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|à|a|tot)\s*(\d+(?:\.\d+)?)$/);
  if (rangeMatch) {
    return Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
  }

  const num = parseFloat(s);
  return Number.isNaN(num) ? null : num;
}

export function formatAmount(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

export interface RawIngredient {
  name: string;
  amount: string | number;
  unit: string;
  product_group: string;
}

export interface NormalizedIngredient {
  name: string;
  amount: number | null;
  unit: string;
  product_group: string;
  raw_text: string | null;
}

export function normalizeIngredient(ing: RawIngredient): NormalizedIngredient {
  const name = normalizeName(ing.name);
  const { unit, factor } = normalizeUnit(ing.unit || '');
  const parsed = parseAmount(ing.amount);
  return {
    name,
    amount: parsed === null ? null : parsed * factor,
    unit,
    product_group: (ing.product_group || 'overig').toLowerCase().trim(),
    raw_text: parsed === null ? `${ing.amount} ${ing.unit}`.trim() : null,
  };
}

/** Insert the ingredient if unknown and return its id. First write wins for unit/group. */
export function upsertIngredient(db: Database.Database, name: string, unit: string, productGroup: string): number {
  db.prepare(
    'INSERT INTO ingredients (name, unit, product_group) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING'
  ).run(name, unit, productGroup);
  const row = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(name) as { id: number };
  return row.id;
}

/** Replace the structured ingredient rows for a recipe with the given list. */
export function syncRecipeIngredients(
  db: Database.Database,
  recipeId: number,
  ingredients: RawIngredient[],
  servings: number = 4,
): void {
  db.prepare('UPDATE recipes SET servings = ? WHERE id = ?').run(servings, recipeId);
  db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(recipeId);

  const insert = db.prepare(
    'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit, raw_text) VALUES (?, ?, ?, ?, ?)'
  );

  for (const ing of ingredients) {
    const norm = normalizeIngredient(ing);
    if (!norm.name) continue;
    const ingredientId = upsertIngredient(db, norm.name, norm.unit, norm.product_group);
    insert.run(recipeId, ingredientId, norm.amount, norm.unit, norm.raw_text);
  }
}

/** Format aggregated per-unit totals as a quantity string, e.g. "400 g" or "2 el, 1 teen". */
export function formatQuantity(byUnit: Map<string, number>): string {
  return Array.from(byUnit.entries())
    .map(([unit, total]) => {
      const value = COUNT_UNITS.has(unit) ? Math.ceil(total) : total;
      return unit ? `${formatAmount(value)} ${unit}` : formatAmount(value);
    })
    .join(', ');
}
