import { getDb } from '../db.js';
import { generatePantryCheck, generateShoppingList } from './shopping-generator.js';
import { syncRecipeIngredients } from './ingredients.js';
import { storedRecipeName } from './recipe-name.js';
import { z } from 'zod';

const IngredientSchema = z.object({
  name: z.string(),
  amount: z.union([z.string(), z.number(), z.null()]),
  unit: z.string(),
  product_group: z.string(),
  note: z.string().nullish(),
});

const RecipeSchema = z.object({
  servings: z.number().int().positive().optional(),
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

/** A day that plans a recipe from the library by its id. */
const LibraryDaySchema = z.object({
  day_name: z.string(),
  recipe_id: z.number().int().positive(),
  // Optional, as a check that the id is the recipe that was meant
  recipe_name: z.string().trim().min(1).optional(),
});

/** A day with a new recipe, written out in full; it joins the library as concept. */
const NewRecipeDaySchema = z.object({
  day_name: z.string(),
  // Stored as the new recipe's name when the library does not have it yet
  recipe_name: z.string().trim().min(1).transform(storedRecipeName),
  meal_type: z.string(),
  prep_time_minutes: z.number(),
  cost_index: z.string(),
  recipe: RecipeSchema,
});

type LibraryDay = z.infer<typeof LibraryDaySchema>;
type NewRecipeDay = z.infer<typeof NewRecipeDaySchema>;

/**
 * A day that mentions recipe_id is a library day, whatever else it holds: an
 * invalid id must fail, not fall through to "new recipe" and get dropped.
 */
const DaySchema = z.unknown().transform((day, ctx): LibraryDay | NewRecipeDay => {
  const isLibraryDay = typeof day === 'object' && day !== null && 'recipe_id' in day;
  const result = (isLibraryDay ? LibraryDaySchema : NewRecipeDaySchema).safeParse(day);
  if (!result.success) {
    for (const issue of result.error.issues) ctx.addIssue(issue);
    return z.NEVER;
  }
  return result.data;
});

/** A problem with the menu's content, reported to the user as is. */
export class MenuImportError extends Error {}

/**
 * Whether a name is the recipe's name, ignoring case, accents, punctuation and
 * spacing ("Pasta pesto!" is "pasta pesto"). Anything more lenient lets a
 * wrong id through, since dishes often share words ("Pasta pesto met kip").
 */
function sameRecipeName(given: string, actual: string): boolean {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const a = norm(given);
  return a !== '' && a === norm(actual);
}

const MenuImportSchema = z.object({
  days: z.array(DaySchema).min(1).max(7),
  // Accepted for backward compatibility but ignored: the shopping list is
  // computed from the structured recipe ingredients, not taken from the LLM.
  shopping_list: z.unknown().optional(),
  snack_suggestions: z.array(
    z.union([
      z.string(),
      z.object({}).passthrough().transform((obj) => {
        // Als het een object is, probeer een naamveld te gebruiken, anders stringify
        if (typeof obj === 'object' && obj !== null) {
          const o = obj as Record<string, unknown>;
          if (typeof o.name === 'string') return o.name;
          if (typeof o.suggestion === 'string') return o.suggestion;
          if (typeof o.snack === 'string') return o.snack;
          if (typeof o.description === 'string') return o.description;
        }
        return String(obj);
      }),
    ])
  ).optional(),
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
      INSERT INTO menu_days (menu_id, day_of_week, day_name, date, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index, recipe_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
    `);

    type LibraryRecipe = {
      id: number; name: string; status: string; recipe_data: string;
      meal_type: string | null; prep_time_minutes: number | null; cost_index: string | null;
    };
    const RECIPE_COLUMNS = 'id, name, status, recipe_data, meal_type, prep_time_minutes, cost_index';
    const findRecipeById = db.prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = ?`);
    // Recipes are identified by name regardless of case (all letters) or surrounding spaces
    const findRecipeByName = db.prepare(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE recipe_key(name) = recipe_key(?)`);
    const insertRecipe = db.prepare(`
      INSERT INTO recipes (name, source, recipe_data, tags, times_used, last_used, meal_type, prep_time_minutes, cost_index)
      VALUES (?, 'weekmenu', ?, ?, 1, date('now'), ?, ?, ?)
    `);
    const refreshRecipe = db.prepare(`
      UPDATE recipes SET
        recipe_data = ?,
        times_used = times_used + 1,
        last_used = date('now'),
        meal_type = COALESCE(meal_type, ?),
        prep_time_minutes = COALESCE(prep_time_minutes, ?),
        cost_index = COALESCE(cost_index, ?)
      WHERE id = ?
    `);
    const markUsed = db.prepare("UPDATE recipes SET times_used = times_used + 1, last_used = date('now') WHERE id = ?");

    for (let i = 0; i < parsed.days.length; i++) {
      const day = parsed.days[i];
      const date = computeDate(day.day_name, monday, firstDayOffset);

      let library: LibraryRecipe | undefined;
      if ('recipe_id' in day) {
        library = findRecipeById.get(day.recipe_id) as LibraryRecipe | undefined;
        if (!library) {
          throw new MenuImportError(`${day.day_name}: recept #${day.recipe_id} staat niet in de bibliotheek`);
        }
        if (library.status === 'archief') {
          throw new MenuImportError(`${day.day_name}: recept #${library.id} "${library.name}" is gearchiveerd`);
        }
        if (day.recipe_name && !sameRecipeName(day.recipe_name, library.name)) {
          throw new MenuImportError(
            `${day.day_name}: recept #${library.id} heet "${library.name}", niet "${day.recipe_name}" — controleer het id`,
          );
        }
      } else {
        const byName = findRecipeByName.get(day.recipe_name) as LibraryRecipe | undefined;
        // An approved recipe is curated: the library version wins over the import
        if (byName?.status === 'goedgekeurd') library = byName;
        else library = undefined;

        if (!library) {
          // Add to the recipe library (new ones start as concept) and sync the
          // structured ingredient rows
          const data = JSON.stringify(day.recipe);
          let recipeId: number;
          if (byName) {
            recipeId = byName.id;
            refreshRecipe.run(data, day.meal_type, day.prep_time_minutes, day.cost_index, recipeId);
          } else {
            recipeId = insertRecipe.run(
              day.recipe_name, data, JSON.stringify([day.meal_type]),
              day.meal_type, day.prep_time_minutes, day.cost_index,
            ).lastInsertRowid as number;
          }
          syncRecipeIngredients(db, recipeId, day.recipe.ingredients, day.recipe.servings ?? 4);
          insertDay.run(
            menuId, i, day.day_name, date, byName?.name ?? day.recipe_name, data,
            day.meal_type, day.prep_time_minutes, day.cost_index, recipeId,
          );
          continue;
        }
      }

      // Planned from the library: the day shows the library version, falling
      // back to the import's meta only where the library has none
      const fallback = 'recipe_id' in day ? null : day;
      markUsed.run(library.id);
      insertDay.run(
        menuId, i, day.day_name, date, library.name, library.recipe_data,
        library.meal_type ?? fallback?.meal_type ?? null,
        library.prep_time_minutes ?? fallback?.prep_time_minutes ?? null,
        library.cost_index ?? fallback?.cost_index ?? null,
        library.id,
      );
    }

    return menuId;
  });

  const menuId = insertAll();

  // Compute shopping list and pantry check from the structured ingredients
  try { generateShoppingList(menuId); } catch (err) { console.error('Shopping list generation failed:', err); }
  try { generatePantryCheck(menuId); } catch (err) { console.error('Pantry check failed:', err); }

  return menuId;
}
