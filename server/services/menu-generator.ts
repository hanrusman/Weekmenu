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

/** Get the Monday of a given ISO week */
function getMondayOfWeek(week: number, year: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // 1=Mon .. 7=Sun
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

// Day name to offset from Monday (0=Mon, 6=Sun)
const DAY_OFFSET: Record<string, number> = {
  'Maandag': 0, 'Dinsdag': 1, 'Woensdag': 2,
  'Donderdag': 3, 'Vrijdag': 4, 'Zaterdag': 5, 'Zondag': 6,
};

/**
 * Compute the calendar date for a day_name within a menu week.
 * Menu runs Thu-Wed: days before the first day in the menu get +7
 * to push them to the next calendar week.
 */
function computeDate(dayName: string, monday: Date, firstDayOffset: number): string {
  let offset = DAY_OFFSET[dayName];
  if (offset === undefined) return '';

  // Days before the menu start day belong to the next week
  if (offset < firstDayOffset) {
    offset += 7;
  }

  const date = new Date(monday);
  date.setUTCDate(monday.getUTCDate() + offset);
  return date.toISOString().split('T')[0]; // "YYYY-MM-DD"
}

/**
 * Get the target week number for a menu import.
 * Menu runs Thu-Wed. If importing on Wed-Sun, target the upcoming Thursday's week.
 * If importing on Thu-Tue (menu already started), target current week.
 */
export function getTargetWeek(date: Date): { weekNumber: number; year: number } {
  const day = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Thu=4, Fri=5, Sat=6, Sun=0, Mon=1, Tue=2 -> current week (menu started or about to)
  // Wed=3 -> next Thursday's week
  // Actually: if we're past Thursday, the menu is running.
  // If before Thursday, we're preparing for the upcoming Thursday.
  const daysUntilThu = day < 4
    ? 4 - day       // Sun=4, Mon=3, Tue=2, Wed=1
    : day === 4
      ? 0            // Thu: current
      : 4 + 7 - day; // Fri=6->5+7-5=6? No...

  // Simpler: Thu-Wed = menu week. If today is Thu or later (Thu,Fri,Sat), it's this week.
  // If today is Sun,Mon,Tue,Wed it could still be this week's menu running.
  // User said they import on weekends for the upcoming week.
  // So: Sat,Sun,Mon,Tue,Wed -> target next Thursday
  // Thu,Fri -> current week (menu just started or starting today)
  let targetDate: Date;
  if (day === 4 || day === 5) {
    // Thursday or Friday - current week
    targetDate = date;
  } else {
    // Sat-Wed: target upcoming Thursday
    const daysToThu = (4 - day + 7) % 7 || 7;
    targetDate = new Date(date);
    targetDate.setDate(date.getDate() + daysToThu);
  }

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

  // Compute dates for each day
  const monday = getMondayOfWeek(wk, yr);

  // Find the first day in the imported data to determine menu start
  const firstDay = parsed.days[0];
  const firstDayOffset = DAY_OFFSET[firstDay.day_name] ?? 3; // Default to Thursday

  const db = getDb();

  const insertAll = db.transaction(() => {
    // Replace existing menu for same week if re-importing
    const existing = db.prepare('SELECT id FROM menus WHERE week_number = ? AND year = ?').get(wk, yr) as { id: number } | undefined;
    if (existing) {
      db.prepare('DELETE FROM menus WHERE id = ?').run(existing.id);
    }

    // Multiple menus can be active (rolling calendar)
    const result = db.prepare(
      'INSERT INTO menus (week_number, year, status, snack_suggestions) VALUES (?, ?, ?, ?)'
    ).run(wk, yr, 'active', JSON.stringify(parsed.snack_suggestions || []));
    const menuId = result.lastInsertRowid as number;

    const insertDay = db.prepare(`
      INSERT INTO menu_days (menu_id, day_of_week, day_name, date, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
    `);

    for (let i = 0; i < parsed.days.length; i++) {
      const day = parsed.days[i];
      const date = computeDate(day.day_name, monday, firstDayOffset);
      insertDay.run(
        menuId,
        i,
        day.day_name,
        date,
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
