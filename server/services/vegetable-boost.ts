import type Database from 'better-sqlite3';
import { z } from 'zod';
import { loadAliases, normalizeIngredient } from './ingredients.js';
import { extractJson } from './recipe-parser.js';
import { CARBS_MINIMUM, MealCheck, mealCheckOf, mealChecks, PROTEIN_MINIMUM } from './meal-check.js';
import { COURSES, Course, RecipeError, RecipeInput, getRecipe, parseRecipeInput, recipeInputOf, saveRecipe } from './recipes.js';
import { regenerateActiveMenus } from './shopping-generator.js';
import { VEGETABLE_MINIMUM, VEGETABLE_TARGET, vegetableScoreOf, vegetableScores } from './vegetables.js';

/**
 * Asking a model to tell what kind of dish a recipe is and to bring a dinner
 * up to the family's vegetable aim, as a whole meal, without turning it into
 * another dish. The model proposes; the app recounts the vegetables and the
 * carbohydrate and protein itself before anything is saved.
 */

export const BOOST_SYSTEM_PROMPT = `Je bent een kok die recepten voor een Nederlands gezin aanpast aan de Schijf van Vijf. Het gezin wil per volwassen portie ${VEGETABLE_TARGET} g groente bij de avondmaaltijd.

Wat telt als groente: alle groenten, ook tomaten uit blik, passata en diepvriesgroente, sla, spinazie, paddenstoelen, maïs, doperwten, sperziebonen, avocado. Wat NIET telt: aardappelen, peulvruchten (kikkererwten, linzen, witte/zwarte/kidneybonen), olijven, citroen/limoen, knoflook, gember, peper en verse kruiden.

Je hoeft niet tot op de gram te rekenen: de app telt de groente zelf na en vraagt het opnieuw als het te weinig is. Houd je denkwerk kort en geef snel het antwoord.

Werkwijze:
1. Bepaal eerst wat voor gerecht het is ("course"): "hoofdgerecht" (de avondmaaltijd), "bijgerecht" (iets naast een hoofdgerecht: een salade, rijst, geroosterde groente), "lunch", "ontbijt", "snack" (hapjes, iets tussendoor) of "toetje" (ook taart en gebak). Is het geen hoofdgerecht, geef dan alleen "course" en verander niets.
2. Is het een hoofdgerecht, breng dan de groente naar minstens ${VEGETABLE_TARGET} g per portie:
   - verhoog eerst de groente die er al in zit, zodat het gerecht herkenbaar blijft;
   - voeg daarna groente toe die past (in de saus, op de ovenschaal, door de salade);
   - past er niet meer in zonder dat het een ander gerecht wordt, zet er dan een bijgerecht naast: een salade, rauwkost, snoepgroente of geroosterde groente. Een pizza blijft een pizza, met een flinke bak snoepgroente of salade erbij.
3. Een hoofdgerecht is een hele maaltijd: minstens ${CARBS_MINIMUM} g koolhydraten en ${PROTEIN_MINIMUM} g eiwit per portie. Ontbreekt er iets, vul het dan aan met wat erbij past: brood bij soep, aardappelen, rijst of couscous bij een stoofpot of salade, ei, kaas, peulvruchten, vis of kip bij een vegetarische pasta. Waren er al genoeg, laat ze dan zoals ze zijn.
   Is het eigenlijk geen maaltijd maar iets voor ernaast (een groene salade, gegrilde groente), kies dan "bijgerecht" in plaats van het aan te vullen.
4. Laat het aantal personen en de naam ongewijzigd. Haal geen ingrediënten weg.
5. Geef toegevoegde groente in grammen (of stuks bij iets als paprika of komkommer), voor het hele recept.
6. Pas de bereiding aan: verwerk wat erbij komt in de bestaande stappen, of voeg een stap toe voor het bijgerecht.
7. Lukt ${VEGETABLE_TARGET} g evident niet zonder het gerecht te veranderen (pizza, tosti, pannenkoeken), zet dan "exception": true en haal minstens ${VEGETABLE_MINIMUM} g met een bijgerecht. Laat bij zo'n gerecht het beleg zoals het is: de groente komt ernaast.
8. Eén product per ingrediëntregel, met een eenvoudige naam in het enkelvoud ("paprika", niet "paprika (rood of geel)"); opmerkingen gaan in "note". Geen alternatieven met "of".
9. Werk "nutrition_per_serving" bij als het recept die had (kcal, eiwit, vezels, ijzer per portie, geschat).

Antwoord met ALLEEN dit JSON-object, zonder uitleg en zonder markdown:
{
  "course": "hoofdgerecht",
  "exception": false,
  "ingredients": [{"name": "courgette", "amount": 400, "unit": "g", "product_group": "groenten", "note": null}],
  "steps": ["..."],
  "nutrition_per_serving": {"calories": 520, "protein_g": 30, "fiber_g": 10, "iron_mg": 4},
  "summary": "In één zin wat er bij is gekomen"
}
"ingredients" en "steps" zijn de volledige nieuwe lijsten (ook wat ongewijzigd blijft). product_group is een van: groenten, fruit, vis, vlees, zuivel, droogwaren, kruiden, sauzen, diepvries, brood, olie, overig.`;

export interface BoostInput {
  name: string;
  servings: number;
  ingredients: Array<{ name: string; amount: number | string | null; unit: string; product_group: string; note?: string | null }>;
  steps: string[];
}

/** The user message: the recipe as JSON, with its current counts and what is asked. */
export function boostPrompt(recipe: BoostInput, perServing: number, meal: MealCheck): string {
  return [
    `Recept (${recipe.servings} personen), nu ${perServing} g groente per portie; doel ${VEGETABLE_TARGET} g per portie, dus ${VEGETABLE_TARGET * recipe.servings} g groente voor het hele recept.`,
    `Geschat nu ${meal.carbs_per_serving} g koolhydraten en ${meal.protein_per_serving} g eiwit per portie`
      + (meal.missing.length ? `; als hoofdgerecht mist het ${meal.missing.join(' en ')}.` : '; dat is genoeg.'),
    JSON.stringify({ name: recipe.name, servings: recipe.servings, ingredients: recipe.ingredients, steps: recipe.steps }, null, 1),
  ].join('\n\n');
}

export const BoostResultSchema = z.object({
  course: z.enum(COURSES),
  exception: z.boolean().default(false),
  ingredients: z.array(z.object({
    name: z.string().trim().min(1).max(100),
    amount: z.union([z.number(), z.string().max(30), z.null()]),
    unit: z.string().max(30).default(''),
    product_group: z.string().max(30).default('overig'),
    note: z.string().max(200).nullish(),
  })).max(60).default([]),
  steps: z.array(z.string().trim().min(1).max(2000)).max(40).default([]),
  nutrition_per_serving: z.object({
    calories: z.number(), protein_g: z.number(), fiber_g: z.number(), iron_mg: z.number(),
  }).nullish(),
  summary: z.string().max(500).default(''),
});

export type BoostResult = z.infer<typeof BoostResultSchema>;

// Bake-off (2026-10-01, 7 recipes): glm kept the dish recognisable and put
// what did not fit beside it; mistral did fine but less fitting; gemma mostly
// scaled up and piled more on a pizza. glm is slow (up to ~80 s) and once gave
// nothing usable, hence the fallback.
const LITELLM_URL = process.env.LITELLM_URL;
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const PRIMARY = process.env.VEGETABLE_MODEL || 'cloud-glm';
const FALLBACK = process.env.VEGETABLE_FALLBACK_MODEL || 'cloud-mistral';
/**
 * Attempts in order. glm sometimes thinks its whole budget away without an
 * answer (a pizza: 16k tokens of reasoning), so it gets a second, roomier
 * try before mistral, which is not a reasoning model but keeps a dish less
 * well (it piled more on the pizza).
 */
export const BOOST_ATTEMPTS: Array<{ model: string; maxTokens: number }> = [
  { model: PRIMARY, maxTokens: 16000 },
  { model: PRIMARY, maxTokens: 32000 },
  { model: FALLBACK, maxTokens: 8000 },
];
// Runs in the background job, not behind the proxy's 60 s timeout
const TIMEOUT_MS = 300_000;

export type ChatMessage = { role: 'system' | 'user'; content: string };
export type ModelCall = (model: string, messages: ChatMessage[], maxTokens: number) => Promise<string>;

/** One chat completion through the shared LiteLLM proxy; the answer's content. */
export const callModel: ModelCall = async (model, messages, maxTokens) => {
  if (!LITELLM_URL || !LITELLM_API_KEY) throw new RecipeError('Taalmodel niet geconfigureerd (LITELLM_URL / LITELLM_API_KEY)', 503);
  const response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LITELLM_API_KEY}` },
    // Reasoning models think before they answer: leave room for both
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: maxTokens, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${model} gaf een fout (${response.status})`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${model} gaf geen antwoord`);
  return content;
};

export type BoostOutcome = 'boosted' | 'not_main' | 'enough' | 'failed' | 'stale';

export interface BoostReport {
  outcome: BoostOutcome;
  before: number;
  after?: number;
  note: string;
}

/** A proposal that cannot be used, with the reason the next attempt is told. */
class Rejected extends Error {}

// Words that describe or package a product, not what it is
const DESCRIBING = new Set([
  'uit', 'blik', 'pot', 'met', 'van', 'het', 'een', 'vers', 'verse', 'gedroogd', 'gedroogde', 'rode', 'gele', 'groene',
  'witte', 'zwarte', 'grote', 'kleine', 'fijne', 'grove', 'stuks', 'naar', 'smaak', 'bot', 'vel', 'zonder',
  'in', 'op', 'en', 'of', 'de', 'te', 'na', 'om',
]);

/**
 * The words that say what an ingredient is: "kippendijen (met bot en vel)" →
 * kippendijen, "kleine ui (heel fijn gesneden)" → ui, "ui, gesnipperd" → ui.
 * What is between brackets or after a comma is how it is prepared.
 */
function keyWords(name: string): string[] {
  return name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(',')[0]
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/).filter((w) => w.length >= 2 && !DESCRIBING.has(w));
}

/** Edit distance, for telling a typo from another word. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The same word, also singular against plural ("kippendij", "kippendijen";
 * "tomaat", "tomaten"; "ui", "uien"; "ei", "eieren") and with a typo in a long
 * word ("worchestershiresaus").
 */
function sameWord(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 8 && distance(short, long) <= 2) return true;
  if (short.length >= 4) return long.startsWith(short.slice(0, Math.max(4, short.length - 2)));
  return short === long || (long.startsWith(short) && long.length <= short.length + 4);
}

/**
 * Original ingredients the proposal no longer has. A renamed one still
 * counts ("rode paprika" as "paprika", "tonijn uit blik" as "tonijn in
 * olijfolie"): it only has to share a word that says what it is. Herbs, oil,
 * salt and pepper are not held to it; a model may well split or merge those.
 */
export function droppedIngredients(
  original: Array<{ name: string; product_group: string }>,
  proposed: Array<{ name: string }>,
): string[] {
  const proposedWords = proposed.map((p) => keyWords(p.name));
  return original
    .filter((o) => !['kruiden', 'olie'].includes(o.product_group) && !/^(?:zout|peper|zout en peper)$/.test(o.name.toLowerCase()))
    .filter((o) => {
      const words = keyWords(o.name);
      return words.length > 0 && !proposedWords.some((p) => words.some((w) => p.some((x) => sameWord(w, x))));
    })
    .map((o) => o.name);
}

function record(db: Database.Database, id: number, outcome: BoostOutcome | 'reverted', note: string) {
  db.prepare(`
    UPDATE recipes SET veg_outcome = ?, veg_note = ?, veg_checked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).run(outcome, note.slice(0, 500), id);
}

/**
 * What the recipe holds that someone can change while the model thinks
 * (minutes): an edit, its status or a label. Null once it is deleted.
 */
function fingerprint(db: Database.Database, id: number): string | null {
  const row = db.prepare(`
    SELECT name, recipe_data, status, meal_type, prep_time_minutes, cost_index, course, veg_exception
    FROM recipes WHERE id = ?
  `).get(id);
  return row ? JSON.stringify(row) : null;
}

const STALE_NOTE = 'intussen bewerkt, niet aangepast; de volgende ronde probeert het opnieuw';

/** Changed since the run read it: write nothing, and leave it for the next run. */
function staleReport(db: Database.Database, id: number, before: number): BoostReport {
  db.prepare("UPDATE recipes SET veg_outcome = 'stale', veg_note = ?, veg_checked_at = NULL WHERE id = ?").run(STALE_NOTE, id);
  return { outcome: 'stale', before, note: STALE_NOTE };
}

/** What a dinner still lacks, as the next attempt is told. */
function lacking(meal: MealCheck): string {
  return meal.missing.map((part) => part === 'koolhydraten'
    ? `${meal.carbs_per_serving} g koolhydraten per persoon, onder de ${CARBS_MINIMUM} g`
    : `${meal.protein_per_serving} g eiwit per persoon, onder de ${PROTEIN_MINIMUM} g`).join(' en ');
}

/**
 * Bring one recipe up to its vegetable norm as a whole meal: the model
 * proposes, the app recounts vegetables, carbohydrate and protein and checks
 * nothing was dropped, and only then saves it, keeping the original as a
 * revision. A recipe whose kind is not known yet is classified first; one
 * the model calls something else than a dinner gets that course instead.
 * The outcome is recorded on the recipe either way.
 *
 * The model can take minutes, so every write afterwards first checks the
 * recipe is still as it was read (same synchronous transaction as the write);
 * if someone edited it meanwhile, nothing is written over their change.
 */
export async function boostRecipe(db: Database.Database, id: number, call: ModelCall = callModel): Promise<BoostReport> {
  const recipe = getRecipe(db, id);
  const snapshot = fingerprint(db, id);
  const changed = () => fingerprint(db, id) !== snapshot;
  const before = recipe.veg_per_serving;
  const known = recipe.course !== null;
  if (known && !recipe.main_course) {
    record(db, id, 'not_main', `${recipe.course}, geen hoofdgerecht`);
    return { outcome: 'not_main', before, note: `${recipe.course}, geen hoofdgerecht` };
  }
  const norm = recipe.veg_exception ? VEGETABLE_MINIMUM : VEGETABLE_TARGET;
  const original = recipeInputOf(recipe);
  // Counted from the saved ingredient rows, like the vegetables and the bulk run's selection
  const meal = mealChecks(db, [id]).get(id)!;
  const fine = before >= norm && meal.missing.length === 0;
  if (known && fine) {
    record(db, id, 'enough', 'haalt de norm al');
    return { outcome: 'enough', before, note: 'haalt de norm al' };
  }

  /** Set the course the model gave, nothing else. */
  const classify = (course: Course, outcome: 'not_main' | 'enough', note: string) => db.transaction((): BoostReport => {
    if (changed()) return staleReport(db, id, before);
    db.prepare("UPDATE recipes SET course = ?, main_course = (? = 'hoofdgerecht') WHERE id = ?").run(course, course, id);
    record(db, id, outcome, note);
    return { outcome, before, note };
  })();

  const aliases = loadAliases(db);
  // Compared by the names saving would give them
  const named = (list: RecipeInput['ingredients']) => list.map((i) => ({
    name: normalizeIngredient({ ...i, product_group: i.product_group ?? 'overig' }, aliases).name || i.name,
    product_group: i.product_group ?? 'overig',
  }));
  const prompt = boostPrompt({
    name: original.name, servings: original.servings, ingredients: original.ingredients, steps: original.steps,
  }, before, meal);

  let reason = '';
  // Set once a model calls it a dinner, even if no proposal passes
  let dinner = false;
  for (const { model, maxTokens } of BOOST_ATTEMPTS) {
    const messages: ChatMessage[] = [{ role: 'system', content: BOOST_SYSTEM_PROMPT }, { role: 'user', content: prompt }];
    if (reason) messages.push({ role: 'user', content: `Een eerder voorstel werd afgewezen: ${reason}. Doe het opnieuw.` });
    try {
      const parsed = BoostResultSchema.safeParse(extractJson(await call(model, messages, maxTokens)));
      if (!parsed.success) throw new Rejected('het antwoord had niet het gevraagde formaat');
      const result = parsed.data;
      if (result.course !== 'hoofdgerecht') {
        return classify(result.course, 'not_main', `${result.course} volgens het model`);
      }
      dinner = true;
      // Only the kind was unknown: a dinner that already does well stays as it is
      if (fine) return classify('hoofdgerecht', 'enough', 'hoofdgerecht volgens het model; haalt de norm al');

      const dropped = droppedIngredients(named(original.ingredients), named(result.ingredients));
      if (dropped.length) throw new Rejected(`ingrediënten weggelaten: ${dropped.join(', ')}`);
      const exception = result.exception || original.veg_exception === true;
      const proposalNorm = exception ? VEGETABLE_MINIMUM : VEGETABLE_TARGET;
      const score = vegetableScoreOf(db, result.ingredients, original.servings);
      const proposedMeal = mealCheckOf(db, result.ingredients, original.servings);
      const shortfalls = [
        score.per_serving < proposalNorm ? `${score.per_serving} g groente per persoon, onder de ${proposalNorm} g` : '',
        lacking(proposedMeal),
      ].filter(Boolean);
      if (shortfalls.length) throw new Rejected(shortfalls.join('; '));

      const updated = parseRecipeInput({
        ...original,
        ingredients: result.ingredients,
        steps: result.steps.length ? result.steps : original.steps,
        // The old estimate no longer fits a recipe with this much more vegetables
        nutrition_per_serving: result.nutrition_per_serving ?? null,
        course: 'hoofdgerecht',
        veg_exception: exception,
      });
      const saved = db.transaction((): boolean => {
        if (changed()) return false;
        saveRecipe(db, updated, id);
        const after = vegetableScores(db, [id]).get(id)?.per_serving ?? score.per_serving;
        db.prepare(`
          INSERT INTO recipe_revisions (recipe_id, reason, input, veg_before, veg_after, summary)
          VALUES (?, 'groente', ?, ?, ?, ?)
        `).run(id, JSON.stringify(original), before, after, result.summary);
        record(db, id, 'boosted', result.summary || `aangevuld tot ${after} g`);
        return true;
      })();
      if (!saved) return staleReport(db, id, before);
      regenerateActiveMenus([id]);
      const after = vegetableScores(db, [id]).get(id)!.per_serving;
      return { outcome: 'boosted', before, after, note: result.summary };
    } catch (err) {
      if (err instanceof RecipeError && err.status === 503) throw err; // not configured: nothing to retry
      reason = (err as Error).message;
      console.warn(`Groente #${id} via ${model} afgewezen: ${reason}`);
    }
  }
  return db.transaction((): BoostReport => {
    // An edit meanwhile may have fixed it, or made it worth another try
    if (changed()) return staleReport(db, id, before);
    // Not topped up, but its kind is known now: planned as the dinner it is, with what it lacks
    if (!known && dinner) db.prepare("UPDATE recipes SET course = 'hoofdgerecht', main_course = 1 WHERE id = ?").run(id);
    record(db, id, 'failed', `niet gelukt: ${reason}`);
    return { outcome: 'failed', before, note: `niet gelukt: ${reason}` };
  })();
}

/**
 * Undo the vegetable change: the recipe goes back to how it was before,
 * including edits made since. It is not picked up again by a bulk run.
 */
export function revertVegetables(db: Database.Database, id: number): void {
  const revision = db.prepare(`
    SELECT input FROM recipe_revisions WHERE recipe_id = ? AND reason = 'groente' ORDER BY id DESC LIMIT 1
  `).get(id) as { input: string } | undefined;
  if (!revision) throw new RecipeError('Er is geen groente-aanpassing om terug te zetten', 404);
  db.transaction(() => {
    saveRecipe(db, parseRecipeInput(JSON.parse(revision.input)), id);
    db.prepare("DELETE FROM recipe_revisions WHERE recipe_id = ? AND reason = 'groente'").run(id);
    record(db, id, 'reverted', 'teruggezet');
  })();
  regenerateActiveMenus([id]);
}
