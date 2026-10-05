import { parseRecipeText } from './recipe-parser.js';
import { RecipeError, RecipeInput, parseRecipeInput } from './recipes.js';

/**
 * Imported recipes in English, translated to Dutch: the ingredient library,
 * the shopping list and the vegetable and meal checks all go by Dutch names.
 * A bulk JSON import is asked to be in Dutch, but a converter may forget.
 */

// Words only one of the two languages uses, to tell which a recipe is in
const ENGLISH = /\b(the|and|with|until|into|add|heat|stir|minutes|cups?|tablespoons?|tbsp|teaspoons?|tsp|chopped|sliced|minced|large|small|fresh|onion|garlic|clove|salt|pepper|sauce|bowl|then|of|to)\b/g;
const DUTCH = /\b(de|het|een|en|met|tot|voeg|verhit|roer|bak|kook|minuten|snijd|meng|ui|knoflook|teen|zout|peper|saus|kom|daarna|van|aan|op)\b/g;

/** Whether a recipe is in English rather than Dutch, by its name, ingredients and steps. */
export function looksEnglish(input: Pick<RecipeInput, 'name' | 'ingredients' | 'steps'>): boolean {
  const text = [input.name, ...input.ingredients.map((i) => i.name), ...input.steps].join(' ').toLowerCase();
  const english = text.match(ENGLISH)?.length ?? 0;
  const dutch = text.match(DUTCH)?.length ?? 0;
  return english >= 5 && english > dutch * 2;
}

/** The recipe as text for the parser, which writes it out in Dutch. */
function asText(input: RecipeInput): string {
  const lines = [input.name, `For ${input.servings} people`, '', 'Ingredients:'];
  for (const i of input.ingredients) {
    lines.push(`- ${[i.amount ?? '', i.unit, i.name].join(' ').trim()}${i.note ? ` (${i.note})` : ''}`);
  }
  lines.push('', 'Method:', ...input.steps.map((step, n) => `${n + 1}. ${step}`));
  if (input.tip) lines.push('', `Tip: ${input.tip}`);
  return lines.join('\n');
}

/** Why a translation cannot be used, or null when it can. */
function problemWith(original: RecipeInput, translated: RecipeInput): string | null {
  const needed = Math.ceil(original.ingredients.length * 0.7);
  if (translated.ingredients.length < needed) {
    return `${translated.ingredients.length} van de ${original.ingredients.length} ingrediënten kwamen terug`;
  }
  if (original.steps.length > 0 && translated.steps.length === 0) return 'de bereiding kwam niet terug';
  if (looksEnglish(translated)) return 'het antwoord was nog Engels';
  return null;
}

/**
 * The recipe in Dutch: the import parser writes out what needs translating
 * (name, ingredients with units from the app's list, steps, tip); everything
 * else (servings, time, cost, nutrition, status, source, kind) stays as it
 * was delivered, the model's estimates only filling a gap. A translation
 * that lost ingredients or the steps, or is still English, gets one more try
 * and is then refused, so the import can be tried again.
 */
export async function translateToDutch(input: RecipeInput): Promise<RecipeInput> {
  const text = asText(input);
  let problem = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let draft;
    try {
      draft = await parseRecipeText(text);
    } catch (err) {
      if (err instanceof RecipeError && err.status === 503) throw err; // not configured: nothing to retry
      problem = (err as Error).message;
      continue;
    }
    const translated = parseRecipeInput({
      name: draft.name.trim() || input.name,
      ingredients: draft.ingredients,
      steps: draft.steps.map((step) => step.trim()).filter(Boolean),
      tip: draft.tip,
      servings: input.servings,
      status: input.status,
      source: input.source,
      course: input.course ?? draft.course,
      meal_type: input.meal_type ?? draft.meal_type,
      prep_time_minutes: input.prep_time_minutes
        ?? (draft.prep_time_minutes !== null && draft.prep_time_minutes <= 1440 ? draft.prep_time_minutes : null),
      cost_index: input.cost_index,
      nutrition_per_serving: input.nutrition_per_serving ?? draft.nutrition_per_serving,
      veg_exception: input.veg_exception,
    });
    const found = problemWith(input, translated);
    if (!found) return translated;
    problem = found;
  }
  throw new RecipeError(`Vertalen mislukt: ${problem}. Probeer het opnieuw.`, 502);
}
