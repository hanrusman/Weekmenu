import type { Recipe } from './api';

/**
 * What a dinner brings in vegetables per serving at least, and the minimum
 * for an exception (pizza night); as on the server.
 */
export const VEGETABLE_TARGET = 250;
export const VEGETABLE_MINIMUM = 175;
/** What each person eats during the day besides: snack vegetables, at lunch, as a snack. */
export const VEGETABLE_DAYTIME = 100;
/** Grams of dry pasta, rice or noodles the family cooks for four servings: 80 g for an adult, 45 g for a child (as in server/services/portions.ts). */
export const CARBS_BASE = 250;
export const CARBS_ADULT = 80;
export const CARBS_CHILD = 45;

type Scored = Pick<Recipe, 'main_course' | 'veg_exception' | 'veg_per_serving'>;

/** The grams this recipe should reach: the aim, or the minimum for an exception. */
export function vegetableNorm(recipe: Scored): number {
  return recipe.veg_exception ? VEGETABLE_MINIMUM : VEGETABLE_TARGET;
}

/** A dinner that does not reach its norm; recipes that are no dinner are not held to it. */
export function tooFewVegetables(recipe: Scored): boolean {
  return recipe.main_course && recipe.veg_per_serving < vegetableNorm(recipe);
}
