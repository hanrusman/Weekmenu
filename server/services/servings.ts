import type Database from 'better-sqlite3';
import { Course, RecipeInput, getRecipe, recipeInputOf, saveRecipe } from './recipes.js';
import { regenerateActiveMenus } from './shopping-generator.js';
import { isVegetable } from './vegetables.js';

/**
 * Every recipe for the same household: two adults and two children, counted
 * as four servings. Amounts are scaled and rounded to what you would measure;
 * quantities the steps mention ("2 el olijfolie", "400 ml water", "over 2
 * borden") follow, times, temperatures and sizes do not.
 */

export const HOUSEHOLD_SERVINGS = 4;

/** Baking and batches (a cake for 12, 20 energy balls) are made whole, not per household. */
const UNSCALED_COURSES: ReadonlySet<Course> = new Set(['toetje', 'snack']);

export function scalesToHousehold(course: Course | null | undefined): boolean {
  return !course || !UNSCALED_COURSES.has(course);
}

/**
 * Rounded to what you would measure: grams and millilitres in steps of 1 to
 * 50 g, kilos and litres to a tenth, sprigs whole, spoons, pieces and the rest in halves.
 */
function rounded(value: number, unit: string, up = false): number {
  const round = up ? Math.ceil : Math.round;
  if (/^(g|gram|ml)$/.test(unit)) {
    const step = value >= 1000 ? 50 : value >= 100 ? 10 : value >= 10 ? 5 : 1;
    return Math.max(step, round(value / step) * step);
  }
  if (/^(kg|l|liter)$/.test(unit)) return Math.max(0.1, round(value * 10) / 10);
  // Half a sprig is not a thing
  if (/^takjes?$/.test(unit)) return Math.max(1, round(value));
  return Math.max(0.5, round(value * 2) / 2);
}

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

function parseNumber(text: string): number | null {
  const t = text.trim();
  if (FRACTIONS[t] !== undefined) return FRACTIONS[t];
  const mixed = t.match(/^(\d+)\s*([½¼¾⅓⅔])$/);
  if (mixed) return Number(mixed[1]) + FRACTIONS[mixed[2]];
  const fraction = t.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const n = Number(t.replace(',', '.'));
  return t !== '' && Number.isFinite(n) ? n : null;
}

/** Dutch notation: a decimal comma, no trailing zeros. */
function format(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/**
 * An ingredient amount times `factor`; a pinch stays a pinch, "naar smaak"
 * stays as it is. `up` rounds up, for vegetables: rounding must not take the
 * recipe below the family's vegetable aim.
 */
export function scaleAmount(amount: number | string | null, unit: string, factor: number, up = false): number | string | null {
  if (amount === null || factor === 1 || unit === 'snufje') return amount;
  if (typeof amount === 'number') return rounded(amount * factor, unit, up);
  const range = amount.match(/^\s*([\d.,½¼¾⅓⅔/]+)\s*-\s*([\d.,½¼¾⅓⅔/]+)\s*$/);
  if (range) {
    const [low, high] = [parseNumber(range[1]), parseNumber(range[2])];
    if (low !== null && high !== null) return `${format(rounded(low * factor, unit, up))}-${format(rounded(high * factor, unit, up))}`;
  }
  const n = parseNumber(amount);
  return n === null ? amount : rounded(n * factor, unit, up);
}

// A quantity in a step: a number (also "1,5", "½", "1/2", "2-3") before a unit of measure
// or a count of plates or people. Not before minutes, degrees or centimetres.
const NUMBER = String.raw`\d+(?:[.,]\d+)?(?:\s*[½¼¾⅓⅔])?|[½¼¾⅓⅔]|\d+\/\d+`;
const MEASURE = String.raw`g|gram|kg|ml|cl|dl|l|liter|el|eetlepels?|tl|theelepels?|teentjes?|tenen|blikjes?|blikken|potjes?|zakjes?`;
const COUNTED = String.raw`personen|porties|borden|bordjes|kommen|kommetjes|glazen`;
const STEP_QUANTITY = new RegExp(String.raw`(?<![\d.,])(${NUMBER})(\s*(?:-|tot)\s*(${NUMBER}))?(\s*)(${MEASURE}|${COUNTED})\b`, 'gi');

// Spellings of a unit in steps, by the unit ingredient lines use
const UNIT_SPELLINGS: Array<[RegExp, string]> = [
  [/^(g|gram)$/, 'g'], [/^(l|liter)$/, 'l'], [/^(el|eetlepels?)$/, 'el'], [/^(tl|theelepels?)$/, 'tl'],
  [/^(teen|teentjes?|tenen)$/, 'teen'], [/^(blik|blikjes?|blikken)$/, 'blik'], [/^(pot|potjes?)$/, 'pot'], [/^(zak|zakjes?)$/, 'zak'],
];

function unitKey(unit: string): string {
  const u = unit.toLowerCase();
  return UNIT_SPELLINGS.find(([re]) => re.test(u))?.[1] ?? u;
}

/**
 * A vegetable line as scaled for the ingredient list: a step that names the
 * same amount of it gets the same, rounded-up amount ("500 g spinazie" for six
 * is 340 g in both), so following the steps keeps the vegetable aim too.
 */
export interface ScaledVegetable {
  /** The amount before scaling, as a range; a single amount is low = high. */
  low: number;
  high: number;
  unit: string;
  scaledLow: number;
  scaledHigh: number;
  /** The start of each word of its name: also "tomaten" for "tomaat". */
  stems: string[];
}

/** An amount as a range: 500 → [500, 500], "500-600" → [500, 600]; null when it is no number. */
function rangeOf(amount: number | string | null): [number, number] | null {
  if (typeof amount === 'number') return [amount, amount];
  if (amount === null) return null;
  const range = amount.match(/^\s*([\d.,½¼¾⅓⅔/]+)\s*-\s*([\d.,½¼¾⅓⅔/]+)\s*$/);
  const [low, high] = range ? [parseNumber(range[1]), parseNumber(range[2])] : [parseNumber(amount), parseNumber(amount)];
  return low === null || high === null ? null : [low, high];
}

function vegetableLine(name: string, unit: string, [low, high]: [number, number], [scaledLow, scaledHigh]: [number, number]): ScaledVegetable {
  const stems = name.toLowerCase().split(/[^a-zà-ÿ]+/).filter((w) => w.length >= 4)
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));
  return { low, high, unit: unitKey(unit), scaledLow, scaledHigh, stems };
}

/** The quantities a step mentions, times `factor`; a vegetable it names as in `vegetables`. */
export function scaleStep(step: string, factor: number, vegetables: ScaledVegetable[] = []): string {
  if (factor === 1) return step;
  return step.replace(STEP_QUANTITY, (match, first: string, rangeTail: string | undefined, second: string | undefined,
    space: string, unit: string, offset: number) => {
    const lower = unit.toLowerCase();
    const counted = new RegExp(`^(${COUNTED})$`).test(lower);
    const scale = (text: string) => {
      const n = parseNumber(text);
      if (n === null) return text;
      const value = n * factor;
      // Plates and people are whole; measures round like ingredient amounts
      return format(counted ? Math.max(1, Math.round(value)) : rounded(value, lower));
    };
    // The same amount (or range) of a vegetable named right after it: the ingredient list's amount
    const [low, high] = [parseNumber(first), parseNumber(second ?? first)];
    const following = step.slice(offset + match.length, offset + match.length + 40).toLowerCase();
    const vegetable = vegetables.find((v) => v.low === low && v.high === high && v.unit === unitKey(unit)
      && v.stems.some((stem) => following.includes(stem)));
    if (rangeTail && second) {
      const separator = rangeTail.slice(0, rangeTail.length - second.length);
      return vegetable
        ? `${format(vegetable.scaledLow)}${separator}${format(vegetable.scaledHigh)}${space}${unit}`
        : `${scale(first)}${separator}${scale(second)}${space}${unit}`;
    }
    return `${vegetable ? format(vegetable.scaledLow) : scale(first)}${space}${unit}`;
  });
}

/** What scaling needs of a recipe: a stored one, an editor's input or a parsed draft. */
interface Scalable {
  servings: number;
  ingredients: Array<{ name: string; amount: number | string | null; unit: string; product_group: string }>;
  steps: string[];
  course?: Course | null;
}

/** The recipe for `to` servings: amounts and the quantities in the steps scaled. */
export function scaleRecipe<T extends Scalable>(input: T, to: number = HOUSEHOLD_SERVINGS): T {
  const factor = to / input.servings;
  if (factor === 1) return input;
  const vegetables: ScaledVegetable[] = [];
  const ingredients = input.ingredients.map((i) => {
    const vegetable = isVegetable(i.name, i.product_group);
    const amount = scaleAmount(i.amount, i.unit, factor, vegetable);
    const [original, scaled] = [rangeOf(i.amount), rangeOf(amount)];
    if (vegetable && original && scaled) vegetables.push(vegetableLine(i.name, i.unit, original, scaled));
    return { ...i, amount };
  });
  return {
    ...input,
    servings: to,
    ingredients,
    steps: input.steps.map((s) => scaleStep(s, factor, vegetables)),
  };
}

/** A draft or import for the household, unless it is baking or a batch. */
export function forHousehold<T extends Scalable>(input: T): T {
  return scalesToHousehold(input.course) ? scaleRecipe(input) : input;
}

export type ServingsOutcome = 'scaled' | 'unchanged' | 'not_scaled';

/**
 * Bring a stored recipe to the household's servings, keeping the original as
 * a revision. A vegetable top-up's original is scaled too, so undoing that
 * keeps the household's servings.
 */
export function normalizeServings(db: Database.Database, id: number): ServingsOutcome {
  const recipe = getRecipe(db, id);
  if (!scalesToHousehold(recipe.course)) return 'not_scaled';
  const input = recipeInputOf(recipe);
  if (input.servings === HOUSEHOLD_SERVINGS) return 'unchanged';
  db.transaction(() => {
    saveRecipe(db, scaleRecipe(input), id);
    db.prepare(`
      INSERT INTO recipe_revisions (recipe_id, reason, input, summary) VALUES (?, 'porties', ?, ?)
    `).run(id, JSON.stringify(input), `${input.servings} → ${HOUSEHOLD_SERVINGS} personen`);
    const revisions = db.prepare("SELECT id, input FROM recipe_revisions WHERE recipe_id = ? AND reason = 'groente'").all(id) as
      Array<{ id: number; input: string }>;
    const update = db.prepare('UPDATE recipe_revisions SET input = ? WHERE id = ?');
    for (const revision of revisions) {
      const original = JSON.parse(revision.input) as RecipeInput;
      update.run(JSON.stringify(scaleRecipe(original)), revision.id);
    }
  })();
  regenerateActiveMenus([id]);
  return 'scaled';
}

/** Every recipe in the library to the household's servings; what came of it, by outcome. */
export function normalizeAllServings(db: Database.Database): Record<ServingsOutcome, number> {
  const counts: Record<ServingsOutcome, number> = { scaled: 0, unchanged: 0, not_scaled: 0 };
  for (const { id } of db.prepare('SELECT id FROM recipes ORDER BY id').all() as Array<{ id: number }>) {
    counts[normalizeServings(db, id)]++;
  }
  return counts;
}
