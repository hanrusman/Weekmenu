import type Database from 'better-sqlite3';

// Product groups whose items belong in the pantry check (staples you likely have)
export const PANTRY_GROUPS = ['kruiden', 'droogwaren', 'olie', 'sauzen', 'zuivel'];

// Product groups that are perishable on the shopping list
export const PERISHABLE_GROUPS = ['groenten', 'fruit', 'vis', 'vlees', 'zuivel', 'brood'];

// Units that represent countable things: round up to whole numbers when shopping
const COUNT_UNITS = new Set([
  'stuks', 'teen', 'blik', 'pot', 'zak', 'bos', 'plak', 'krop', 'stengel', 'bakje',
  'snee', 'vel', 'bodem', 'bol', 'pak', 'fles', 'blad',
]);

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
  blikken: { unit: 'blik', factor: 1 },
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
  tsp: { unit: 'tl', factor: 1 },
  tbsp: { unit: 'el', factor: 1 },
  krop: { unit: 'krop', factor: 1 },
  kroppen: { unit: 'krop', factor: 1 },
  kropje: { unit: 'krop', factor: 1 },
  kropjes: { unit: 'krop', factor: 1 },
  stengel: { unit: 'stengel', factor: 1 },
  stengels: { unit: 'stengel', factor: 1 },
  bakje: { unit: 'bakje', factor: 1 },
  bakjes: { unit: 'bakje', factor: 1 },
  snee: { unit: 'snee', factor: 1 },
  sneetje: { unit: 'snee', factor: 1 },
  sneetjes: { unit: 'snee', factor: 1 },
  sneden: { unit: 'snee', factor: 1 },
  vel: { unit: 'vel', factor: 1 },
  vellen: { unit: 'vel', factor: 1 },
  velletje: { unit: 'vel', factor: 1 },
  velletjes: { unit: 'vel', factor: 1 },
  bodem: { unit: 'bodem', factor: 1 },
  bodems: { unit: 'bodem', factor: 1 },
  bol: { unit: 'bol', factor: 1 },
  bollen: { unit: 'bol', factor: 1 },
  pak: { unit: 'pak', factor: 1 },
  pakken: { unit: 'pak', factor: 1 },
  pakje: { unit: 'pak', factor: 1 },
  pakjes: { unit: 'pak', factor: 1 },
  fles: { unit: 'fles', factor: 1 },
  flessen: { unit: 'fles', factor: 1 },
  flesje: { unit: 'fles', factor: 1 },
  blad: { unit: 'blad', factor: 1 },
  blaadje: { unit: 'blad', factor: 1 },
  blaadjes: { unit: 'blad', factor: 1 },
};

// Size adjectives that sometimes end up in the unit ("1 grote", "klein potje");
// they carry no quantity information for the shopping list.
const UNIT_SIZE_WORDS = /\b(?:extra\s+)?(?:grote|groot|kleine|klein|middelgrote|middelgroot|flinke|flink)\b/g;

// Exact-match synonyms so the same ingredient aggregates under one canonical name.
// Deliberately a dictionary, not generic plural-stripping: Dutch plurals are too
// irregular to fold automatically (linzen, kersen, ...). These seed the
// ingredient_aliases table; aliases added in the app (merge/rename) live there.
export const SEED_ALIASES: Record<string, string> = {
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
  winterwortel: 'wortel',
  winterwortels: 'wortel',
  winterwortelen: 'wortel',
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
  'vers basilicum': 'verse basilicum',
  basilicum: 'verse basilicum',
  'parmezaanse kaas': 'parmezaan',
  'parmigiano reggiano': 'parmezaan',
  komijn: 'gemalen komijn',
  komijnpoeder: 'gemalen komijn',
  'extra vergine olijfolie': 'olijfolie',
  mais: 'maïs',
  'tonijn in olijfolie': 'tonijn',
  'tonijn in olijfolie uit blik': 'tonijn uit blik',
  'sardines in olijfolie uit blik': 'sardines uit blik',
  'mais uit blik': 'maïs uit blik',
  'komijn (gemalen)': 'gemalen komijn',
  'mosterd (dijon)': 'dijonmosterd',
  'risottorijst (arborio)': 'risottorijst',
  'kikkererwten uit blikje': 'kikkererwten uit blik',
  'volkoren pitabroodjes': 'volkoren pita',
  'volkoren pitabroodje': 'volkoren pita',
  'volkoren wrap': 'volkoren wraps',
  'zeezout en peper': 'zout en peper',
  'peper en zout': 'zout en peper',
};

/** Load the alias -> canonical name map from the database. */
export function loadAliases(db: Database.Database): Map<string, string> {
  const rows = db.prepare('SELECT alias, canonical FROM ingredient_aliases').all() as Array<{ alias: string; canonical: string }>;
  return new Map(rows.map((r) => [r.alias, r.canonical]));
}

/**
 * Split free text into its core and its parenthetical remarks
 * ("stuks (ca. 300g)" -> "stuks" + "ca. 300g"). Used for units, where a
 * remark never changes which unit is meant.
 */
function splitAnnotations(text: string): { core: string; notes: string[] } {
  const notes: string[] = [];
  const core = text
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      if (inner.trim()) notes.push(inner.trim());
      return ' ';
    })
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return { core, notes };
}

// An amount, weight or volume: "300 g", "ca. 1,2 kg", "4 x 80g", "0,5 l", "2 stuks".
// Anything else starting with a digit ("70% cacao") may well name the product.
const QUANTITY_REMARK = new RegExp(
  '^(?:(?:ca\\.?|circa|±|ongeveer|à)\\s*)?\\d+(?:[.,]\\d+)?\\s*'
  + '(?:(?:x|×)\\s*\\d+(?:[.,]\\d+)?\\s*)?'
  + '(?:g|gr|gram|kg|kilo|ml|cl|dl|l|liter|stuks?|st|blik\\w*|pot\\w*|zak\\w*|bos\\w*|bakje\\w*|plak\\w*|teen\\w*|tenen)?\\.?$',
);

// Remarks in an ingredient name that say nothing about which product to buy
const DROPPABLE_REMARKS = [
  QUANTITY_REMARK,
  /^(?:apart |ook |alleen )?voor\b/,
  /^(?:optioneel|naar keuze|naar smaak|uitgelekt|ontdooid|ontdooide|afgespoeld)$/,
];
// "vers of zelfgemaakt", "zelfgemaakt of kant-en-klaar": a choice between
// sourcing options. A single one ("vers") may name the product, so it stays.
const SOURCING_WORDS = new Set(['vers', 'verse', 'zelfgemaakt', 'zelfgebakken', 'kant-en-klaar', 'of']);

function isDroppableRemark(part: string): boolean {
  if (DROPPABLE_REMARKS.some((re) => re.test(part))) return true;
  const words = part.split(' ');
  return words.includes('of') && words.every((w) => SOURCING_WORDS.has(w));
}

const CANNED_SUFFIX = /\s+(?:uit|in) blik(?:je)?$/;
const FROZEN_PREFIX = /^diepvries\s+/;

/**
 * Clean an ingredient name without resolving aliases. Parenthetical remarks
 * are sorted three ways: remarks that don't affect what you buy go to the
 * notes ("voor salade", "uitgelekt"); packaging is spelled one way ("(blik)"
 * and "uit blik" both become "... uit blik", "(diepvries)" becomes
 * "diepvries ..."), so canned stays apart from dried; anything else is part
 * of the product and stays in the name ("paprika (gerookt)").
 */
export function cleanName(name: string): { name: string; notes: string[] } {
  const notes: string[] = [];
  const kept: string[] = [];
  let canned = false;
  let frozen = false;

  let core = name
    .toLowerCase()
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      for (const raw of inner.split(',')) {
        const part = raw.trim().replace(/\s+/g, ' ');
        if (!part) continue;
        if (/^(?:uit |in )?blik(?:je)?$/.test(part)) canned = true;
        else if (part === 'diepvries') frozen = true;
        else if (isDroppableRemark(part)) notes.push(part);
        else kept.push(part);
      }
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();

  if (CANNED_SUFFIX.test(core)) {
    canned = true;
    core = core.replace(CANNED_SUFFIX, '');
  }
  if (FROZEN_PREFIX.test(core)) {
    frozen = true;
    core = core.replace(FROZEN_PREFIX, '');
  }
  if (!core) return { name: '', notes };

  let result = core;
  if (frozen) result = `diepvries ${result}`;
  if (canned) result = `${result} uit blik`;
  if (kept.length > 0) result = `${result} (${kept.join(', ')})`;
  return { name: result, notes };
}

/** The product without packaging or variant remarks, for spotting likely duplicates. */
export function productCore(name: string): string {
  return name.replace(/\s*\([^)]*\)/g, '').replace(CANNED_SUFFIX, '').replace(FROZEN_PREFIX, '').trim();
}

/**
 * Resolve a name to its canonical ingredient name. With an alias map (from
 * the database) only that map is used, so aliases removed or redirected in
 * the app stay that way; without one the built-in seed list applies.
 */
export function normalizeName(name: string, aliases?: Map<string, string>): string {
  const cleaned = cleanName(name).name;
  if (aliases) return aliases.get(cleaned) || cleaned;
  return SEED_ALIASES[cleaned] || cleaned;
}

export interface NormalizedUnit {
  unit: string;
  factor: number;
  /** Grams or ml per single unit, from "(à 400g)"-style hints. */
  perUnit?: { amount: number; unit: string };
  notes: string[];
}

export function normalizeUnit(unit: string): NormalizedUnit {
  const { core, notes } = splitAnnotations(unit);
  const cleaned = core.replace(UNIT_SIZE_WORDS, ' ').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const mapped = UNIT_MAP[cleaned] || { unit: cleaned, factor: 1 };

  let perUnit: NormalizedUnit['perUnit'];
  for (const note of notes) {
    // Only "à 400g" is unambiguously per unit; "ca. 300g" may be the total
    const m = note.match(/^à\s*(\d+(?:[.,]\d+)?)\s*(g|gr|gram|kg|ml|l|liter)\b/);
    if (m) {
      const target = UNIT_MAP[m[2]];
      perUnit = { amount: parseFloat(m[1].replace(',', '.')) * target.factor, unit: target.unit };
    }
  }

  return { unit: mapped.unit, factor: mapped.factor, notes, ...(perUnit ? { perUnit } : {}) };
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
  /** Parenthetical remarks stripped from name and unit, kept for display. */
  note: string | null;
  perUnit?: { amount: number; unit: string };
}

export function normalizeIngredient(ing: RawIngredient, aliases?: Map<string, string>): NormalizedIngredient {
  const name = normalizeName(ing.name || '', aliases);
  const nameNotes = cleanName(ing.name || '').notes;
  const normUnit = normalizeUnit(ing.unit || '');
  const parsed = parseAmount(ing.amount);
  // A bare count ("2" ui, "1 grote" ui) has no unit left: that means pieces
  const unit = normUnit.unit === '' && parsed !== null ? 'stuks' : normUnit.unit;
  const notes = [...nameNotes, ...normUnit.notes];
  return {
    name,
    amount: parsed === null ? null : parsed * normUnit.factor,
    unit,
    product_group: (ing.product_group || 'overig').toLowerCase().trim(),
    raw_text: parsed === null ? `${ing.amount ?? ''} ${ing.unit ?? ''}`.trim() : null,
    note: notes.length > 0 ? notes.join('; ') : null,
    ...(normUnit.perUnit ? { perUnit: normUnit.perUnit } : {}),
  };
}

/**
 * Insert the ingredient if unknown and return its id. First write wins for
 * unit and group, except that a specific group replaces the 'overig' fallback.
 */
export function upsertIngredient(db: Database.Database, name: string, unit: string, productGroup: string): number {
  db.prepare(`
    INSERT INTO ingredients (name, unit, product_group) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET product_group = excluded.product_group
    WHERE ingredients.product_group = 'overig'
  `).run(name, unit, productGroup);
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

  const aliases = loadAliases(db);
  const insert = db.prepare(
    'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount, unit, raw_text, note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const baseUnitOf = db.prepare('SELECT unit FROM ingredients WHERE id = ?');
  const learnConversion = db.prepare(
    'INSERT OR IGNORE INTO ingredient_conversions (ingredient_id, unit, factor) VALUES (?, ?, ?)'
  );

  for (const ing of ingredients) {
    const norm = normalizeIngredient(ing, aliases);
    if (!norm.name) continue;
    const ingredientId = upsertIngredient(db, norm.name, norm.unit, norm.product_group);
    insert.run(recipeId, ingredientId, norm.amount, norm.unit, norm.raw_text, norm.note);

    // "2 blikken (à 400g)" teaches us 1 blik = 400 g for this ingredient,
    // whichever of the two is the ingredient's own unit
    if (norm.perUnit && norm.perUnit.unit !== norm.unit) {
      const base = (baseUnitOf.get(ingredientId) as { unit: string }).unit;
      if (base === norm.perUnit.unit) {
        learnConversion.run(ingredientId, norm.unit, norm.perUnit.amount);
      } else if (base === norm.unit) {
        learnConversion.run(ingredientId, norm.perUnit.unit, 1 / norm.perUnit.amount);
      }
    }
  }
}

/**
 * Convert an amount in `unit` to the ingredient's base unit using its
 * conversions (1 unit = factor x base). Returns null if no conversion exists.
 */
export function convertToBase(
  amount: number,
  unit: string,
  baseUnit: string,
  conversions: Map<string, number> | undefined,
): number | null {
  if (unit === baseUnit) return amount;
  const factor = conversions?.get(unit);
  return factor === undefined ? null : amount * factor;
}

/** Load all ingredient conversions as ingredient_id -> (unit -> factor). */
export function loadConversions(db: Database.Database): Map<number, Map<string, number>> {
  const rows = db.prepare('SELECT ingredient_id, unit, factor FROM ingredient_conversions').all() as Array<{
    ingredient_id: number; unit: string; factor: number;
  }>;
  const map = new Map<number, Map<string, number>>();
  for (const r of rows) {
    if (!map.has(r.ingredient_id)) map.set(r.ingredient_id, new Map());
    map.get(r.ingredient_id)!.set(r.unit, r.factor);
  }
  return map;
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
