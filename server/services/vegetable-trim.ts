import type Database from 'better-sqlite3';
import { normalizeUnit } from './ingredients.js';
import { keyWords } from './ingredient-words.js';
import { mealCheckOf } from './meal-check.js';
import {
  COOKED_FROM_DRY, TopUpPart, carbWords, carbsFor, cooksInItsLiquid, dryCarbLines, isMuchMoreCarbs, isWetDish, linesFor, topUpParts, topUpRoom,
} from './portions.js';
import { RecipeError, RecipeInput, getRecipe, parseRecipeInput, recipeInputOf, saveRecipe } from './recipes.js';
import { ScaledVegetable, rangeOf, scaleAmount, scaleStep, vegetableLine } from './servings.js';
import { regenerateActiveMenus } from './shopping-generator.js';
import { Line, VEGETABLE_TARGET, vegetableScoreOf, weigh } from './vegetables.js';

/**
 * Looking a dinner over once more, with the whole portion in view. The top-up
 * run filled every dinner up to its vegetable aim, and where the dish could
 * not carry that it put a mountain of salad next to it. This brings back what
 * was added beyond what fits the plate (see portions.ts): the salad next to
 * the dish to a normal salad, and a dish that is no soup or sauce to what a
 * person finishes. Pasta, rice and the like go to what the family cooks, and
 * what comes off there is room for vegetables.
 *
 * Of the vegetables only what the top-up added gives way: the recipe as it
 * was written keeps all of its own, and a recipe without a top-up only ever
 * gets less pasta or rice. No ingredient is taken out, so the steps still
 * fit. Arithmetic on the ingredient list, no model: the same recipe always
 * comes out the same, and the version before is kept to go back to.
 */

/** Of each vegetable a top-up added, this part at least stays: what it wrote into the steps is still made. */
const ADDED_FLOOR = 0.25;
/** A line that would lose less than this stays as it is. */
const WORTH_CHANGING = 0.92;
/** ... and so does a recipe whose vegetables would not go down to this part at least: half a carrot less is no reason to rewrite it. */
const WORTH_DOING = 0.85;

// Vegetables that are the sauce of a dish rather than what lies on the plate, and what comes by the
// tin or jar: less of it leaves half a tin and a thinner sauce
const SAUCE = /passata|gezeefde tomaten|tomatenblokjes|tomatensaus|gepelde tomaten|pelati|polpa|pelaten|tomaten uit blik/;
const BY_THE_PACK = new Set(['blik', 'pot', 'pak', 'fles', 'ml']);
// The onion a dish starts with is its taste, not its vegetables: half an onion less helps nobody
const ONION = /^(ui|uien|uitje|uitjes|sjalot|sjalotten|sjalotje|sjalotjes)$/;
// What a top-up noted on a line it changed ("verhoogd van 500 g", "toegevoegd") no longer holds once it
// is brought back; what the note says besides ("toegevoegd, in blokjes") stays
const TOP_UP_NOTE = /^\s*(verhoogd|opgehoogd|toegevoegd|extra|aangevuld|nieuw)\b[^,;]*[,;]?\s*/i;
// A weight written next to a count ("4 stuks (ca. 400g)") goes down with it
const TOTAL_HINT = /\((ca\.?|circa|±|ongeveer)\s*(\d+(?:[.,]\d+)?)\s*(g|gram|kg)\)/i;

/** The revision a trim leaves, to go back to; and what it is called once someone went back. */
export const TRIM_REASON = 'groente-minder';
const TRIM_UNDONE = 'groente-minder-teruggezet';

export type TrimOutcome =
  /** Brought back. */
  | 'trimmed'
  /** Its top-up fits the plate as it is. */
  | 'fine'
  /** As it was written, without a top-up, and with no more pasta or rice than the family cooks: left alone. */
  | 'original'
  /** Brought back before, or put back by hand after that: left as it is now. */
  | 'done'
  /** Less would leave it short of carbohydrate or protein. */
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
  /** Grams of vegetables per serving now, and after; null where the recipe was not weighed (no dinner, done before). */
  before: number | null;
  after: number | null;
  changes: TrimChange[];
  summary: string;
  /** The recipe as it would be saved; only with outcome trimmed. */
  updated?: RecipeInput;
}

/** "rode ui", "ui (gesnipperd)", "sjalotjes": an onion by the one word that says what it is; a bosui is a vegetable. */
function isOnion(name: string): boolean {
  const words = keyWords(name);
  return words.length === 1 && ONION.test(words[0]);
}

const fixed = (line: Line) => SAUCE.test(line.name.toLowerCase()) || isOnion(line.name)
  || BY_THE_PACK.has(normalizeUnit(line.unit).unit);

/** "stuks (ca. 400g)" for a count that went from 4 to 2: "stuks (ca. 200 g)". */
function hintScaled(text: string, factor: number): string {
  return text.replace(TOTAL_HINT, (_match, about: string, amount: string, unit: string) => {
    const kilos = unit.toLowerCase() === 'kg';
    const grams = parseFloat(amount.replace(',', '.')) * factor * (kilos ? 1000 : 1);
    // Under a kilo in grams: "ca. 500 g" rather than "ca. 0,5 kg"
    if (kilos && grams >= 1000) return `(${about} ${String(Math.round(grams / 100) / 10).replace('.', ',')} kg)`;
    return `(${about} ${Math.max(10, Math.round(grams / 10) * 10)} g)`;
  });
}

/** "komkommer, tomaat en wortel"; past four names "… en 2 andere". */
function listed(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length > 4) return `${unique.slice(0, 4).join(', ')} en ${unique.length - 4} andere`;
  return unique.join(', ').replace(/, ([^,]*)$/, ' en $1');
}

/**
 * The part of what was added to each vegetable that stays: the salad next to
 * the dish first down to a normal salad, then everything added by the same
 * part until the whole fits. What comes by the tin, the sauce and the onion
 * are not what gives way. `freed` is the room less pasta or rice leaves.
 */
function keepFactors(parts: TopUpPart[], wet: boolean, servings: number, freed: number): Map<number, number> {
  const room = topUpRoom(parts, wet, servings, VEGETABLE_TARGET, freed);
  const added = (p: TopUpPart) => p.grams - p.own;
  const sum = (pick: (p: TopUpPart) => boolean) => parts.filter(pick).reduce((total, p) => total + added(p), 0);
  const free = (p: TopUpPart) => !fixed(p.line);
  const saladFree = sum((p) => p.salad && free(p));
  const saladFixed = sum((p) => p.salad && !free(p));
  const cookedFree = sum((p) => !p.salad && free(p));
  const cookedFixed = sum((p) => !p.salad && !free(p));

  const part = (fits: number, of: number) => (of > 0 ? Math.min(1, Math.max(0, fits) / of) : 1);
  const salad = part(room.saladRoom - saladFixed, saladFree);
  const all = part(room.addedRoom - saladFixed - cookedFixed, saladFree * salad + cookedFree);
  return new Map(parts.map((p) => [p.index, free(p) ? Math.max(ADDED_FLOOR, (p.salad ? salad : 1) * all) : 1]));
}

/**
 * What looking a top-up over would change, without saving anything.
 * `original` is the recipe before its top-up; `dish` says what kind of dish
 * it is, for telling a soup or sauce from a plate.
 */
export function planTrim(
  db: Database.Database, current: RecipeInput, original: RecipeInput, dish: { name: string; meal_type?: string | null },
): TrimPlan {
  const servings = current.servings;
  const before = vegetableScoreOf(db, current.ingredients, servings).per_serving;
  const nothing = (outcome: TrimOutcome): TrimPlan => ({ outcome, before, after: before, changes: [], summary: '' });

  const lines = linesFor(db, current.ingredients);
  const parts = topUpParts(db, current.ingredients, original.ingredients, current.steps);
  const wet = isWetDish(dish, lines);
  // Pasta, rice and the like, by their dry weight; not where they take up a measured amount of liquid
  const carbLines = dryCarbLines(db, current.ingredients, servings);
  const carbGrams = carbLines.reduce((sum, l) => sum + (weigh(l) ?? 0), 0);
  const muchMore = isMuchMoreCarbs(carbGrams, servings) && !cooksInItsLiquid(dish, carbLines, current.steps, lines);
  const carbFactor = muchMore ? carbsFor(servings) / carbGrams : 1;
  // What the recipe had of it as it was written: a top-up that cooked less made room that still counts
  const writtenCarbGrams = dryCarbLines(db, original.ingredients, original.servings).reduce((sum, l) => sum + (weigh(l) ?? 0), 0)
    * (servings / Math.max(1, original.servings));

  /** The recipe with less of what was added (or not), and with or without the pasta or rice at the family's measure. */
  const plan = (withVegetables: boolean, withCarbs: boolean): TrimPlan => {
    const vegetables: TrimChange[] = [];
    const carbs: TrimChange[] = [];
    const inSteps: ScaledVegetable[] = [];
    // Less pasta or rice than the recipe was written with is room for vegetables: about that weight, cooked.
    // Counted as the top-up round counts it, so what was accepted there is not taken back here
    const freed = Math.max(0, writtenCarbGrams - carbGrams * (withCarbs ? carbFactor : 1)) * COOKED_FROM_DRY;
    const keep = keepFactors(parts, wet, servings, freed);

    const ingredients = current.ingredients.map((ingredient, index) => {
      const vegetable = parts.find((p) => p.index === index);
      const isCarb = withCarbs && carbLines.some((l) => l.index === index);
      const factor = vegetable
        ? (withVegetables ? (vegetable.own + keep.get(index)! * (vegetable.grams - vegetable.own)) / vegetable.grams : 1)
        : isCarb ? carbFactor : 1;
      if (factor > WORTH_CHANGING) return ingredient;
      // Vegetables rounded up, so rounding does not take the recipe under its aim
      const amount = scaleAmount(ingredient.amount, ingredient.unit, factor, !!vegetable);
      const [was, is] = [rangeOf(ingredient.amount), rangeOf(amount)];
      if (!was || !is || is[1] >= was[1]) return ingredient;
      const ratio = is[1] / was[1];
      const unit = hintScaled(ingredient.unit, ratio);
      (vegetable ? vegetables : carbs).push({ name: ingredient.name, unit, from: ingredient.amount!, to: amount! });
      const named = vegetableLine(ingredient.name, ingredient.unit, was, is);
      // The steps say "300 g rijst" for the basmatirijst of the list
      inSteps.push(isCarb ? { ...named, words: [...named.words, ...carbWords(ingredient.name)] } : named);
      const note = ingredient.note ? hintScaled(ingredient.note.replace(TOP_UP_NOTE, ''), ratio).trim() || null : null;
      return { ...ingredient, amount, unit, ...(ingredient.note ? { note } : {}) };
    });
    const changes = [...vegetables, ...carbs];
    if (changes.length === 0) return nothing('fine');

    // Peas, maize and the like count towards carbohydrate and protein too, and so does the pasta
    const meal = mealCheckOf(db, current.ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })), servings);
    const mealAfter = mealCheckOf(db, ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })), servings);
    if (mealAfter.missing.some((lack) => !meal.missing.includes(lack))) return nothing('meal');

    const summary = [
      vegetables.length ? `Minder ${listed(vegetables.map((c) => c.name))}` : '',
      ...carbs.map((c) => `${c.name} van ${c.from} naar ${c.to} ${c.unit}`),
    ].filter(Boolean).join('; ');
    return {
      outcome: 'trimmed', before, changes,
      after: vegetableScoreOf(db, ingredients, servings).per_serving,
      summary: `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`,
      // A step that names the old amount gets the new one
      updated: { ...current, ingredients, steps: current.steps.map((step) => scaleStep(step, 1, inSteps)) },
    };
  };

  /** The plan with the pasta or rice at the family's measure, or as it is. */
  const planWith = (withCarbs: boolean): TrimPlan => {
    // Whether the vegetables are worth changing is judged with the pasta or rice as it will be
    const vegetablesToo = plan(true, withCarbs);
    const worthIt = vegetablesToo.outcome === 'trimmed' && vegetablesToo.after! <= before * WORTH_DOING;
    const result = plan(worthIt, withCarbs);
    // Nothing changed, though the vegetables were too much: taking them back would have left the meal short
    return result.outcome === 'fine' && vegetablesToo.outcome === 'meal' ? nothing('meal') : result;
  };
  const lessCarbs = planWith(true);
  // Less pasta or rice would leave the meal short: without that, then
  return lessCarbs.outcome === 'meal' && muchMore ? planWith(false) : lessCarbs;
}

interface DinnerRow { id: number; name: string; course: string | null; status: string; meal_type: string | null }

/** The plan for a stored recipe: against the recipe as it was before its top-up, if it had one. */
export function planTrimOf(db: Database.Database, id: number): TrimPlan {
  const row = db.prepare('SELECT id, name, course, status, meal_type FROM recipes WHERE id = ?').get(id) as DinnerRow | undefined;
  if (!row) throw new RecipeError('Recept niet gevonden', 404);
  // Settled without weighing the recipe, so a run over a library that is done is quick
  const unread = (outcome: TrimOutcome): TrimPlan => ({ outcome, before: null, after: null, changes: [], summary: '' });
  if (row.course !== 'hoofdgerecht' || row.status === 'archief') return unread('not_dinner');
  // Once is enough: a second time would take the same part off again, and who put it back meant it
  const already = db.prepare('SELECT 1 FROM recipe_revisions WHERE recipe_id = ? AND reason IN (?, ?)').get(id, TRIM_REASON, TRIM_UNDONE);
  if (already) return unread('done');
  const revision = db.prepare(`
    SELECT input FROM recipe_revisions WHERE recipe_id = ? AND reason = 'groente' ORDER BY id DESC LIMIT 1
  `).get(id) as { input: string } | undefined;
  const current = recipeInputOf(getRecipe(db, id));
  let original: RecipeInput | null = null;
  try {
    original = revision ? parseRecipeInput(JSON.parse(revision.input)) : null;
  } catch {
    original = null; // an original that cannot be read: as if there is none
  }
  if (original) return planTrim(db, current, original, row);
  // As it was written: nothing was added that could be too much, so only the pasta or rice is looked at
  const plan = planTrim(db, current, current, row);
  return plan.outcome === 'trimmed' ? plan : unread('original');
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

/** Look one recipe's top-up over; what came of it. */
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

const emptyReport = (): TrimReport => ({ counts: { trimmed: 0, fine: 0, original: 0, done: 0, meal: 0, not_dinner: 0 }, trimmed: [] });

/** The dinners a run goes over. */
function dinnersOf(db: Database.Database): Array<{ id: number; name: string }> {
  return db.prepare(`
    SELECT id, name FROM recipes WHERE course = 'hoofdgerecht' AND status != 'archief' ORDER BY id
  `).all() as Array<{ id: number; name: string }>;
}

function tally(report: TrimReport, { id, name }: { id: number; name: string }, plan: TrimPlan): void {
  report.counts[plan.outcome]++;
  if (plan.outcome === 'trimmed') report.trimmed.push({ id, name, before: plan.before!, after: plan.after!, summary: plan.summary });
}

/**
 * Every top-up in the library looked over, all of them or none: a failure
 * halfway leaves the library as it was. With `dryRun` nothing is saved: the
 * report says what would change.
 *
 * The run holds the server until it is done (a quarter of a minute on a slow
 * machine): right for the one time it changes the library, not for showing
 * how many recipes it would change. That is what previewTrimAll is for.
 */
export function trimAllVegetables(db: Database.Database, { dryRun = false }: { dryRun?: boolean } = {}): TrimReport {
  const report = emptyReport();
  db.transaction(() => {
    for (const dinner of dinnersOf(db)) {
      const plan = planTrimOf(db, dinner.id);
      if (plan.outcome === 'trimmed' && !dryRun) applyTrim(db, dinner.id, plan);
      tally(report, dinner, plan);
    }
  })();
  if (!dryRun && report.trimmed.length) regenerateActiveMenus(report.trimmed.map((r) => r.id));
  return report;
}

/** Milliseconds of working out before the server gets to answer its other requests again. */
const PREVIEW_SLICE_MS = 40;

// What a run would change, as worked out last, and the run that is working it out now
const previews = new WeakMap<Database.Database, { mark: string; report: TrimReport }>();
const previewing = new WeakMap<Database.Database, Promise<TrimReport>>();

/** A mark that changes with every write to the database, by this server or by anything else. */
function writeMark(db: Database.Database): string {
  const own = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  return `${db.pragma('data_version', { simple: true })}:${own}`;
}

/**
 * What a run over the library would change, without saving anything and
 * without holding the server up: a few recipes at a time, with the other
 * requests in between. The answer is kept until something is written to the
 * database, and those who ask while it is being worked out share the one run.
 */
export function previewTrimAll(db: Database.Database, { sliceMs = PREVIEW_SLICE_MS }: { sliceMs?: number } = {}): Promise<TrimReport> {
  const kept = previews.get(db);
  if (kept && kept.mark === writeMark(db)) return Promise.resolve(kept.report);
  const busy = previewing.get(db);
  if (busy) return busy;

  const run = (async () => {
    const mark = writeMark(db);
    const report = emptyReport();
    let since = performance.now();
    for (const dinner of dinnersOf(db)) {
      if (performance.now() - since > sliceMs) {
        await new Promise<void>((resolve) => { setImmediate(resolve); });
        since = performance.now();
      }
      let plan: TrimPlan;
      try {
        plan = planTrimOf(db, dinner.id);
      } catch (err) {
        if (err instanceof RecipeError && err.status === 404) continue; // deleted while this was under way
        throw err;
      }
      tally(report, dinner, plan);
    }
    // Something written meanwhile may have changed a recipe that was counted already: good to show, not to keep
    if (writeMark(db) === mark) previews.set(db, { mark, report });
    return report;
  })().finally(() => { previewing.delete(db); });
  previewing.set(db, run);
  return run;
}

/**
 * Undo the trim: the recipe goes back to how it was before it, including
 * edits made since, and is not brought back again by a later run.
 */
export function revertTrim(db: Database.Database, id: number): void {
  const revision = db.prepare(`
    SELECT id, input FROM recipe_revisions WHERE recipe_id = ? AND reason = ? ORDER BY id DESC LIMIT 1
  `).get(id, TRIM_REASON) as { id: number; input: string } | undefined;
  if (!revision) throw new RecipeError('Er is geen aanpassing om terug te zetten', 404);
  db.transaction(() => {
    saveRecipe(db, parseRecipeInput(JSON.parse(revision.input)), id);
    db.prepare('UPDATE recipe_revisions SET reason = ? WHERE id = ?').run(TRIM_UNDONE, revision.id);
  })();
  regenerateActiveMenus([id]);
}
