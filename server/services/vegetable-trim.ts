import type Database from 'better-sqlite3';
import { normalizeUnit } from './ingredients.js';
import { mealCheckOf } from './meal-check.js';
import { RecipeError, RecipeInput, getRecipe, parseRecipeInput, recipeInputOf, saveRecipe } from './recipes.js';
import { ScaledVegetable, rangeOf, scaleAmount, scaleStep, vegetableLine } from './servings.js';
import { regenerateActiveMenus } from './shopping-generator.js';
import { keyWords, sameWord } from './vegetable-boost.js';
import {
  Line, VEGETABLE_CEILING, VEGETABLE_TARGET, isVegetable, linesOf, vegetableScoreOf, vegetablesFor, weigh,
} from './vegetables.js';

/**
 * Bringing a dinner's vegetables back to the family's aim, where a top-up (or
 * a recipe written for the old, higher aim) left more than the family
 * finishes. Amounts only go down. What a top-up added goes first, and never
 * below what the recipe had before it; no ingredient is taken out, so the
 * steps still fit. Arithmetic on the ingredient list, no model: the same
 * recipe always comes out the same, and the version before is kept to go back to.
 */

/** Of what a top-up added, this part at least stays: the side dish it wrote into the steps is still made. */
const ADDED_FLOOR = 0.25;
/** A recipe written for the old aim keeps at least half of each vegetable; less makes another dish. */
const WRITTEN_FLOOR = 0.5;
/** A line that would lose less than this stays as it is. */
const WORTH_CHANGING = 0.92;

// Vegetables that are the sauce of a dish rather than what lies on the plate, and what comes by the
// tin or jar: less of it leaves half a tin and a thinner sauce
const SAUCE = /passata|gezeefde tomaten|tomatenblokjes|tomatensaus|gepelde tomaten|pelati|polpa|pelaten|tomaten uit blik/;
const BY_THE_PACK = new Set(['blik', 'pot', 'pak', 'fles', 'ml']);
// The onion a dish starts with is its taste, not its vegetables: half an onion less helps nobody
const ONION = /^(rode |witte |gele |kleine |grote )?(ui|uien|sjalot|sjalotten)$/;
// What a top-up noted on a line it changed ("verhoogd van 500 g", "toegevoegd") no longer holds once it is brought back
const TOP_UP_NOTE = /^\s*(verhoogd|opgehoogd|toegevoegd|extra|aangevuld|nieuw)\b/i;
// A weight written next to a count ("4 stuks (ca. 400g)") goes down with it
const TOTAL_HINT = /\((ca\.?|circa|±|ongeveer)\s*(\d+(?:[.,]\d+)?)\s*(g|gram|kg)\)/i;

/** The revision a trim leaves, to go back to; and what it is called once someone went back. */
export const TRIM_REASON = 'groente-minder';
const TRIM_UNDONE = 'groente-minder-teruggezet';

export type TrimOutcome =
  /** Brought back. */
  | 'trimmed'
  /** At or under the ceiling already. */
  | 'fine'
  /** Brought back before, or put back by hand after that: left as it is now. */
  | 'done'
  /** Rich in vegetables of its own (a soup, a stamppot as the cookbook has it): nothing a top-up added to take back. */
  | 'own'
  /** Less vegetables would leave it short of carbohydrate or protein. */
  | 'meal'
  /** No dinner, or archived. */
  | 'not_dinner';

export interface TrimChange {
  name: string;
  unit: string;
  from: number | string;
  to: number | string;
}

export interface TrimPlan {
  outcome: TrimOutcome;
  /** Grams of vegetables per adult now, and after. */
  before: number;
  after: number;
  changes: TrimChange[];
  summary: string;
  /** The recipe as it would be saved; only with outcome trimmed. */
  updated?: RecipeInput;
}

/** Vegetable lines of a list that can be weighed, with their grams and the ingredient they come from. */
function weighedVegetables(db: Database.Database, ingredients: RecipeInput['ingredients']): Array<{ line: Line; index: number; grams: number }> {
  return linesOf(db, ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })))
    .filter((line) => isVegetable(line.name, line.group))
    .map((line) => ({ line, index: line.index!, grams: weigh(line) }))
    .filter((v): v is { line: Line; index: number; grams: number } => v.grams !== null && v.grams > 0);
}

/** Whether two ingredient names are the same thing: the same library name, or a word that says what it is in common. */
function sameIngredient(a: string, b: string): boolean {
  if (a === b) return true;
  const words = keyWords(b);
  return keyWords(a).some((w) => words.some((x) => sameWord(w, x)));
}

const fixed = (line: Line) => SAUCE.test(line.name.toLowerCase()) || ONION.test(line.name.toLowerCase())
  || BY_THE_PACK.has(normalizeUnit(line.unit).unit);

/** "stuks (ca. 400g)" for a count that went from 4 to 2: "stuks (ca. 200g)". */
function hintScaled(text: string, factor: number): string {
  return text.replace(TOTAL_HINT, (_match, about: string, amount: string, unit: string) => {
    const value = parseFloat(amount.replace(',', '.')) * factor;
    const shown = unit.toLowerCase() === 'kg' ? String(Math.round(value * 10) / 10).replace('.', ',') : String(Math.round(value / 10) * 10);
    return `(${about} ${shown}${unit.toLowerCase() === 'kg' ? ' ' : ''}${unit})`;
  });
}

/**
 * What bringing a recipe back would do, without saving anything. A recipe
 * written for the old aim (`written`) is brought back evenly, every vegetable
 * by the same part. Any other only gives back what its top-up added:
 * `original` is the recipe before that, and without one it keeps its own
 * vegetables.
 */
export function planTrim(db: Database.Database, current: RecipeInput, original: RecipeInput | null, written: boolean): TrimPlan {
  const before = vegetableScoreOf(db, current.ingredients, current.servings).per_serving;
  const nothing = (outcome: TrimOutcome): TrimPlan => ({ outcome, before, after: before, changes: [], summary: '' });
  if (before <= VEGETABLE_CEILING) return nothing('fine');

  const vegetables = weighedVegetables(db, current.ingredients);
  // The grams of each line that may not go: what the recipe had before its top-up and part of
  // what was added, or half of a recipe written for the old aim
  const floors = new Map<number, number>();
  if (written) {
    for (const v of vegetables) floors.set(v.index, WRITTEN_FLOOR * v.grams);
  } else if (original) {
    const had = weighedVegetables(db, original.ingredients);
    const kept = new Map<number, number>();
    for (const o of had) {
      const same = vegetables.filter((v) => v.line.name === o.line.name);
      const matches = same.length ? same : vegetables.filter((v) => sameIngredient(v.line.name, o.line.name));
      const total = matches.reduce((sum, v) => sum + v.grams, 0);
      // Spread over the lines it became, by their size
      for (const v of matches) kept.set(v.index, (kept.get(v.index) ?? 0) + o.grams * (v.grams / total));
    }
    for (const v of vegetables) {
      const own = Math.min(v.grams, kept.get(v.index) ?? 0);
      floors.set(v.index, own + ADDED_FLOOR * (v.grams - own));
    }
  } else {
    return nothing('own');
  }
  for (const v of vegetables) if (fixed(v.line)) floors.set(v.index, v.grams);

  const total = vegetables.reduce((sum, v) => sum + v.grams, 0);
  const room = vegetables.reduce((sum, v) => sum + v.grams - floors.get(v.index)!, 0);
  const tooMuch = total - vegetablesFor(VEGETABLE_TARGET, current.servings);
  if (room <= 0 || tooMuch <= 0) return nothing('own');
  // Every line gives up the same part of what it can miss
  const part = Math.min(1, tooMuch / room);

  const changes: TrimChange[] = [];
  const stepVegetables: ScaledVegetable[] = [];
  const ingredients = current.ingredients.map((ingredient, index) => {
    const v = vegetables.find((x) => x.index === index);
    if (!v) return ingredient;
    const factor = (v.grams - part * (v.grams - floors.get(index)!)) / v.grams;
    if (factor > WORTH_CHANGING) return ingredient;
    // Rounded up, so rounding does not take the recipe under the aim
    const amount = scaleAmount(ingredient.amount, ingredient.unit, factor, true);
    const [was, is] = [rangeOf(ingredient.amount), rangeOf(amount)];
    if (!was || !is || is[1] >= was[1]) return ingredient;
    changes.push({ name: ingredient.name, unit: ingredient.unit, from: ingredient.amount!, to: amount! });
    stepVegetables.push(vegetableLine(ingredient.name, ingredient.unit, was, is));
    const ratio = is[1] / was[1];
    const note = ingredient.note && !TOP_UP_NOTE.test(ingredient.note) ? hintScaled(ingredient.note, ratio) : null;
    return { ...ingredient, amount, unit: hintScaled(ingredient.unit, ratio), ...(ingredient.note ? { note } : {}) };
  });
  if (changes.length === 0) return nothing('own');

  const after = vegetableScoreOf(db, ingredients, current.servings).per_serving;
  if (after >= before) return nothing('own');
  // Peas, maize and the like count towards carbohydrate and protein too
  const meal = mealCheckOf(db, current.ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })), current.servings);
  const mealAfter = mealCheckOf(db, ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })), current.servings);
  if (mealAfter.missing.some((lack) => !meal.missing.includes(lack))) return nothing('meal');

  const names = [...new Set(changes.map((c) => c.name))];
  const listed = names.length > 4 ? `${names.slice(0, 4).join(', ')} en ${names.length - 4} andere` : names.join(', ').replace(/, ([^,]*)$/, ' en $1');
  return {
    outcome: 'trimmed', before, after, changes,
    summary: `Minder ${listed}.`,
    // A step that names the old amount of a vegetable gets the new one
    updated: { ...current, ingredients, steps: current.steps.map((step) => scaleStep(step, 1, stepVegetables)) },
  };
}

interface DinnerRow { id: number; name: string; course: string | null; status: string; source: string | null; meal_type: string | null }

/** The plan for a stored recipe: with the original of its top-up, when it had one. */
export function planTrimOf(db: Database.Database, id: number): TrimPlan {
  const recipe = getRecipe(db, id);
  const row = db.prepare('SELECT id, name, course, status, source, meal_type FROM recipes WHERE id = ?').get(id) as DinnerRow;
  const current = recipeInputOf(recipe);
  if (row.course !== 'hoofdgerecht' || row.status === 'archief') {
    return { outcome: 'not_dinner', before: recipe.veg_per_serving, after: recipe.veg_per_serving, changes: [], summary: '' };
  }
  // Once is enough: a second time would take the same part off again, and who put it back meant it
  const already = db.prepare('SELECT 1 FROM recipe_revisions WHERE recipe_id = ? AND reason IN (?, ?)').get(id, TRIM_REASON, TRIM_UNDONE);
  if (already) return { outcome: 'done', before: recipe.veg_per_serving, after: recipe.veg_per_serving, changes: [], summary: '' };
  const revision = db.prepare(`
    SELECT input FROM recipe_revisions WHERE recipe_id = ? AND reason = 'groente' ORDER BY id DESC LIMIT 1
  `).get(id) as { input: string } | undefined;
  let original: RecipeInput | null = null;
  try { original = revision ? parseRecipeInput(JSON.parse(revision.input)) : null; } catch { /* an original that cannot be read: as if there is none */ }
  // Written by the menu planner for the old aim of 350 g a serving; a soup is its vegetables
  const soup = row.meal_type === 'soep' || /soep/i.test(row.name);
  const written = row.source === 'weekmenu' && !soup;
  return planTrim(db, current, original, written);
}

/** Save a plan: the recipe as it was becomes a revision to go back to. */
function applyTrim(db: Database.Database, id: number, plan: TrimPlan): void {
  const current = recipeInputOf(getRecipe(db, id));
  db.transaction(() => {
    saveRecipe(db, parseRecipeInput(plan.updated), id);
    db.prepare(`
      INSERT INTO recipe_revisions (recipe_id, reason, input, veg_before, veg_after, summary) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, TRIM_REASON, JSON.stringify(current), plan.before, plan.after, plan.summary);
  })();
}

/** Bring one recipe's vegetables back to the aim; what came of it. */
export function trimVegetables(db: Database.Database, id: number): TrimPlan {
  const plan = planTrimOf(db, id);
  if (plan.outcome === 'trimmed') {
    applyTrim(db, id, plan);
    regenerateActiveMenus([id]);
  }
  return plan;
}

export interface TrimReport {
  counts: Record<TrimOutcome, number>;
  /** What changed (or would), by recipe. */
  trimmed: Array<{ id: number; name: string; before: number; after: number; summary: string }>;
}

/**
 * Every dinner in the library back to the aim. With `dryRun` nothing is
 * saved: the report says what would change.
 */
export function trimAllVegetables(db: Database.Database, { dryRun = false }: { dryRun?: boolean } = {}): TrimReport {
  const report: TrimReport = { counts: { trimmed: 0, fine: 0, done: 0, own: 0, meal: 0, not_dinner: 0 }, trimmed: [] };
  const dinners = db.prepare(`
    SELECT id, name FROM recipes WHERE course = 'hoofdgerecht' AND status != 'archief' ORDER BY id
  `).all() as Array<{ id: number; name: string }>;
  for (const { id, name } of dinners) {
    const plan = planTrimOf(db, id);
    report.counts[plan.outcome]++;
    if (plan.outcome !== 'trimmed') continue;
    if (!dryRun) applyTrim(db, id, plan);
    report.trimmed.push({ id, name, before: plan.before, after: plan.after, summary: plan.summary });
  }
  if (!dryRun && report.trimmed.length) regenerateActiveMenus(report.trimmed.map((r) => r.id));
  return report;
}

/**
 * Undo the trim: the recipe goes back to how it was before it, including
 * edits made since, and is not brought back again by a later run.
 */
export function revertTrim(db: Database.Database, id: number): void {
  const revision = db.prepare(`
    SELECT id, input FROM recipe_revisions WHERE recipe_id = ? AND reason = ? ORDER BY id DESC LIMIT 1
  `).get(id, TRIM_REASON) as { id: number; input: string } | undefined;
  if (!revision) throw new RecipeError('Er is geen groente-aanpassing om terug te zetten', 404);
  db.transaction(() => {
    saveRecipe(db, parseRecipeInput(JSON.parse(revision.input)), id);
    db.prepare('UPDATE recipe_revisions SET reason = ? WHERE id = ?').run(TRIM_UNDONE, revision.id);
  })();
  regenerateActiveMenus([id]);
}
