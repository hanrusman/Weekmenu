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

/**
 * The recipe in Dutch, through the import parser (names, units from the
 * app's list, steps), keeping its status, source and kind. Refused when the
 * parser lost ingredients along the way.
 */
export async function translateToDutch(input: RecipeInput): Promise<RecipeInput> {
  const text = asText(input);
  // The parser model now and then answers without valid JSON: one more try
  let draft;
  try {
    draft = await parseRecipeText(text);
  } catch (err) {
    if (err instanceof RecipeError && err.status === 503) throw err;
    draft = await parseRecipeText(text);
  }
  if (draft.ingredients.length < Math.ceil(input.ingredients.length * 0.7)) {
    throw new RecipeError(`Vertalen mislukt: ${draft.ingredients.length} van de ${input.ingredients.length} ingrediënten kwamen terug`, 502);
  }
  return parseRecipeInput({
    ...draft,
    name: draft.name.trim() || input.name,
    status: input.status,
    source: input.source,
    course: input.course ?? draft.course,
    meal_type: draft.meal_type ?? input.meal_type,
    prep_time_minutes: draft.prep_time_minutes !== null && draft.prep_time_minutes <= 1440 ? draft.prep_time_minutes : input.prep_time_minutes,
    nutrition_per_serving: draft.nutrition_per_serving ?? input.nutrition_per_serving,
    tip: draft.tip ?? input.tip,
    steps: draft.steps.map((step) => step.trim()).filter(Boolean),
  });
}
