import { getDb } from '../db.js';

interface MenuDay {
  id: number;
  day_name: string;
  recipe_data: string;
  status: string;
  completed_at: string | null;
}

interface Ingredient {
  name: string;
  amount: string;
  unit: string;
  product_group: string;
}

export function generatePantryCheck(menuId: number): void {
  const db = getDb();

  // Get remaining (not completed) days
  const remainingDays = db.prepare(
    'SELECT * FROM menu_days WHERE menu_id = ? AND status != ?'
  ).all(menuId, 'completed') as MenuDay[];

  // Clear existing pantry check
  db.prepare('DELETE FROM pantry_check WHERE menu_id = ?').run(menuId);

  const pantryItems = new Map<string, Set<string>>();

  for (const day of remainingDays) {
    let recipe: { ingredients?: Ingredient[] };
    try {
      recipe = JSON.parse(day.recipe_data);
    } catch {
      continue; // Skip days with malformed recipe data
    }
    if (!recipe.ingredients) continue;

    for (const ing of recipe.ingredients) {
      // Focus on staple/pantry items
      const group = (ing.product_group || '').toLowerCase();
      const isPantryItem = ['kruiden', 'droogwaren', 'olie', 'sauzen', 'zuivel'].some(
        (g) => group.includes(g)
      );
      if (!isPantryItem) continue;

      const key = ing.name.toLowerCase();
      if (!pantryItems.has(key)) {
        pantryItems.set(key, new Set());
      }
      pantryItems.get(key)!.add(day.day_name);
    }
  }

  const insertPantry = db.prepare(
    'INSERT INTO pantry_check (menu_id, item_name, needed_for_days) VALUES (?, ?, ?)'
  );

  for (const [item, days] of pantryItems) {
    insertPantry.run(menuId, item, JSON.stringify(Array.from(days)));
  }
}
