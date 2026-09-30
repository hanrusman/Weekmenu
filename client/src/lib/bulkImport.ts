import type { RecipeInput } from './api';

/**
 * Recipes from a JSON file: an array, or {"recipes": [...]}. Throws with a
 * readable message when the text is not such a list.
 */
export function recipesFromJson(text: string): Array<Partial<RecipeInput>> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Dit is geen geldige JSON');
  }
  const list = Array.isArray(data) ? data
    : Array.isArray((data as { recipes?: unknown })?.recipes) ? (data as { recipes: unknown[] }).recipes
      : null;
  if (!list) throw new Error('Verwacht een JSON-array met recepten (of {"recipes": [...]})');
  return list.filter((r): r is Partial<RecipeInput> => Boolean(r) && typeof r === 'object');
}

/**
 * How to read an uploaded file. The extension decides when it can: a
 * Markdown file may well start with "[[Inhoud]]" or "[link](#...)". Only
 * without a known extension does the content decide.
 */
export function detectFormat(fileName: string, text: string): 'json' | 'markdown' {
  if (/\.json$/i.test(fileName)) return 'json';
  if (/\.(md|markdown|txt)$/i.test(fileName)) return 'markdown';
  try {
    recipesFromJson(text);
    return 'json';
  } catch {
    return 'markdown';
  }
}
