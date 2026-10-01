import type { Recipe } from './api';

/** What kind of dish a recipe is, as on the server; only a hoofdgerecht is planned as dinner. */
export const COURSES = ['hoofdgerecht', 'bijgerecht', 'lunch', 'ontbijt', 'snack', 'toetje'] as const;
export type Course = typeof COURSES[number];
/** What a dinner can lack to be a whole meal. */
export type MealPart = 'koolhydraten' | 'eiwit';

/** How each kind of dish is named in the app. */
export const COURSE_LABELS: Record<Course, string> = {
  hoofdgerecht: 'Hoofdgerecht',
  bijgerecht: 'Bijgerecht',
  lunch: 'Lunch',
  ontbijt: 'Ontbijt',
  snack: 'Snack',
  toetje: 'Toetje',
};

/** A dinner that is no whole meal yet: it lacks carbohydrate or protein. */
export function incompleteMeal(recipe: Pick<Recipe, 'meal_missing'>): boolean {
  return recipe.meal_missing.length > 0;
}
