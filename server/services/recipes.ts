import { getDb } from '../db.js';
import { syncRecipeIngredients, RawIngredient } from './ingredients.js';

export class RecipeError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export interface RecipeUpdate {
  recipe_data: Record<string, unknown>;
  tags?: string[];
  name?: string;
  prep_time_minutes?: number;
  cost_index?: string;
}

/**
 * Update a recipe. Renaming propagates to menu_days.recipe_name everywhere;
 * recipe_data snapshots only update in active menus (archived menus keep the
 * historical version that was cooked).
 */
export function updateRecipe(id: number, patch: RecipeUpdate): void {
  const db = getDb();

  const existing = db.prepare('SELECT id, name FROM recipes WHERE id = ?').get(id) as { id: number; name: string } | undefined;
  if (!existing) {
    throw new RecipeError('Recept niet gevonden', 404);
  }

  const newName = typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : null;
  if (newName && newName.length > 200) {
    throw new RecipeError('Naam is verplicht (max 200 tekens)', 400);
  }
  if (newName && newName !== existing.name) {
    const conflict = db.prepare('SELECT id FROM recipes WHERE name = ? COLLATE NOCASE AND id != ?').get(newName, id);
    if (conflict) {
      throw new RecipeError('Er bestaat al een recept met deze naam', 409);
    }
  }

  const recipeJson = JSON.stringify(patch.recipe_data);
  db.transaction(() => {
    db.prepare(`
      UPDATE recipes SET recipe_data = ?, tags = COALESCE(?, tags),
        name = COALESCE(?, name),
        prep_time_minutes = COALESCE(?, prep_time_minutes),
        cost_index = COALESCE(?, cost_index)
      WHERE id = ?
    `).run(
      recipeJson,
      patch.tags ? JSON.stringify(patch.tags) : null,
      newName,
      typeof patch.prep_time_minutes === 'number' ? patch.prep_time_minutes : null,
      typeof patch.cost_index === 'string' ? patch.cost_index : null,
      id,
    );

    if (newName && newName !== existing.name) {
      db.prepare('UPDATE menu_days SET recipe_name = ? WHERE recipe_id = ?').run(newName, id);
    }
    db.prepare(`
      UPDATE menu_days SET recipe_data = ?
      WHERE recipe_id = ? AND menu_id IN (SELECT id FROM menus WHERE status = 'active')
    `).run(recipeJson, id);
  })();

  const ingredients = (patch.recipe_data as { ingredients?: RawIngredient[] }).ingredients;
  if (Array.isArray(ingredients)) {
    syncRecipeIngredients(db, id, ingredients, (patch.recipe_data as { servings?: number }).servings ?? 4);
  }
}
