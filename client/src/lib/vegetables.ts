import type { Recipe } from './api';

/** The family's vegetable aim per adult serving, and the minimum for an exception (pizza night); as on the server. */
export const VEGETABLE_TARGET = 350;
export const VEGETABLE_MINIMUM = 250;

type Scored = Pick<Recipe, 'main_course' | 'veg_exception' | 'veg_per_serving'>;

/** The grams this recipe should reach: the aim, or the minimum for an exception. */
export function vegetableNorm(recipe: Scored): number {
  return recipe.veg_exception ? VEGETABLE_MINIMUM : VEGETABLE_TARGET;
}

/** A dinner that does not reach its norm; recipes that are no dinner are not held to it. */
export function tooFewVegetables(recipe: Scored): boolean {
  return recipe.main_course && recipe.veg_per_serving < vegetableNorm(recipe);
}
