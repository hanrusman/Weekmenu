/**
 * The identity of a recipe name: case-insensitive for every letter, where
 * SQLite's NOCASE only folds ASCII ("Crème brûlée" = "CRÈME BRÛLÉE"), the
 * same for both Unicode spellings of an accented letter, and without
 * surrounding spaces. Available in SQL as recipe_key(name) (see db.ts).
 */
export function recipeNameKey(name: string): string {
  return name.trim().toLowerCase().normalize('NFC');
}

/**
 * A recipe name as it is stored: trimmed and in one Unicode spelling (NFC),
 * so the NOCASE index sees the same bytes for the same name. Every path that
 * writes a name goes through this: the recipe editor and imports
 * (RecipeInputSchema) and new recipes from a menu (importMenu).
 */
export function storedRecipeName(name: string): string {
  return name.trim().normalize('NFC');
}
