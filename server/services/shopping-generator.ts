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

interface PantryEntry {
  days: Set<string>;
  amounts: Array<{ amount: string; unit: string }>;
}

export function generatePantryCheck(menuId: number): void {
  const db = getDb();

  // Get remaining (not completed) days
  const remainingDays = db.prepare(
    'SELECT * FROM menu_days WHERE menu_id = ? AND status != ?'
  ).all(menuId, 'completed') as MenuDay[];

  // Clear existing pantry check
  db.prepare('DELETE FROM pantry_check WHERE menu_id = ?').run(menuId);

  const pantryItems = new Map<string, PantryEntry>();

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
        pantryItems.set(key, { days: new Set(), amounts: [] });
      }
      const entry = pantryItems.get(key)!;
      entry.days.add(day.day_name);
      if (ing.amount && ing.unit) {
        entry.amounts.push({ amount: ing.amount, unit: ing.unit });
      }
    }
  }

  const insertPantry = db.prepare(
    'INSERT INTO pantry_check (menu_id, item_name, quantity, needed_for_days) VALUES (?, ?, ?, ?)'
  );

  for (const [item, entry] of pantryItems) {
    // Aggregate quantities: try to sum same units, otherwise list them
    const quantity = summarizeAmounts(entry.amounts);
    insertPantry.run(menuId, item, quantity, JSON.stringify(Array.from(entry.days)));
  }
}

function summarizeAmounts(amounts: Array<{ amount: string; unit: string }>): string {
  if (amounts.length === 0) return '';

  // Group by unit
  const byUnit = new Map<string, number>();
  for (const { amount, unit } of amounts) {
    const num = parseFloat(amount);
    if (isNaN(num)) continue;
    const u = unit.toLowerCase();
    byUnit.set(u, (byUnit.get(u) || 0) + num);
  }

  if (byUnit.size === 0) return '';

  return Array.from(byUnit.entries())
    .map(([unit, total]) => `${total % 1 === 0 ? total : total.toFixed(1)} ${unit}`)
    .join(', ');
}
