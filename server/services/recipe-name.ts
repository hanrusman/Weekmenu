/**
 * The identity of a recipe name: case-insensitive for every letter, where
 * SQLite's NOCASE only folds ASCII ("Crème brûlée" = "CRÈME BRÛLÉE"), the
 * same for both Unicode spellings of an accented letter, and without
 * surrounding spaces. Available in SQL as recipe_key(name) (see db.ts).
 */
export function recipeNameKey(name: string): string {
  return name.trim().toLowerCase().normalize('NFC');
}
