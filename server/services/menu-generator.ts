import { getDb } from '../db.js';
import { generatePantryCheck } from './shopping-generator.js';
import { z } from 'zod';

const IngredientSchema = z.object({
  name: z.string(),
  amount: z.string(),
  unit: z.string(),
  product_group: z.string(),
});

const RecipeSchema = z.object({
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()),
  nutrition_per_serving: z.object({
    calories: z.number(),
    protein_g: z.number(),
    fiber_g: z.number(),
    iron_mg: z.number(),
  }),
  tip: z.string().optional(),
});

const DaySchema = z.object({
  day_name: z.string(),
  recipe_name: z.string(),
  meal_type: z.string(),
  prep_time_minutes: z.number(),
  cost_index: z.string(),
  recipe: RecipeSchema,
});

const MenuImportSchema = z.object({
  days: z.array(DaySchema).min(1).max(7),
  shopping_list: z.array(z.object({
    product_group: z.string(),
    items: z.array(z.object({
      name: z.string(),
      quantity: z.string(),
      for_days: z.array(z.string()),
      is_perishable: z.boolean().optional(),
      storage_tip: z.string().optional(),
    })),
  })),
  snack_suggestions: z.array(z.string()).optional(),
});

export type MenuImport = z.infer<typeof MenuImportSchema>;

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * Get the target week number for a menu import.
 * Menu runs Wed-Mon. If importing on Sat-Tue, target the upcoming Wednesday's week.
 * If importing on Wed-Fri, target current week.
 */
export function getTargetWeek(date: Date): { weekNumber: number; year: number } {
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Wed=3, Thu=4, Fri=5 -> current week (the menu already started)
  // Sat=6, Sun=0, Mon=1, Tue=2 -> next Wednesday's week
  const daysUntilWed = day <= 2
    ? 3 - day             // Sun=3, Mon=2, Tue=1
    : day <= 5
      ? 0                 // Wed-Fri: 0 (current week)
      : 4;                // Sat: 4 days until next Wed

  const targetDate = new Date(date);
  targetDate.setDate(targetDate.getDate() + daysUntilWed);

  return {
    weekNumber: getISOWeek(targetDate),
    year: targetDate.getFullYear(),
  };
}

export function importMenu(jsonData: unknown, weekNumber?: number, year?: number): number {
  const parsed = MenuImportSchema.parse(jsonData);

  const target = getTargetWeek(new Date());
  const wk = weekNumber || target.weekNumber;
  const yr = year || target.year;

  const db = getDb();

  const insertAll = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM menus WHERE week_number = ? AND year = ?').get(wk, yr) as { id: number } | undefined;
    if (existing) {
      db.prepare('DELETE FROM menus WHERE id = ?').run(existing.id);
    }

    // Archive any currently active menu
    db.prepare("UPDATE menus SET status = 'archived' WHERE status = 'active'").run();

    // Insert as active directly (no draft/approve flow needed)
    const result = db.prepare(
      'INSERT INTO menus (week_number, year, status, snack_suggestions) VALUES (?, ?, ?, ?)'
    ).run(wk, yr, 'active', JSON.stringify(parsed.snack_suggestions || []));
    const menuId = result.lastInsertRowid as number;

    const insertDay = db.prepare(`
      INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')
    `);

    for (let i = 0; i < parsed.days.length; i++) {
      const day = parsed.days[i];
      insertDay.run(
        menuId,
        i,
        day.day_name,
        day.recipe_name,
        JSON.stringify(day.recipe),
        day.meal_type,
        day.prep_time_minutes,
        day.cost_index,
      );
    }

    const insertItem = db.prepare(`
      INSERT INTO shopping_items (menu_id, product_group, item_name, quantity, for_days, is_perishable, storage_tip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const group of parsed.shopping_list) {
      for (const item of group.items) {
        insertItem.run(
          menuId,
          group.product_group,
          item.name,
          item.quantity,
          JSON.stringify(item.for_days),
          item.is_perishable ? 1 : 0,
          item.storage_tip || null,
        );
      }
    }

    return menuId;
  });

  const menuId = insertAll();

  // Generate pantry check immediately
  try { generatePantryCheck(menuId); } catch (err) { console.error('Pantry check failed:', err); }

  return menuId;
}
