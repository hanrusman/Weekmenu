/**
 * Menu days with the version of their library recipe's own picture, so the
 * week view can show it. Append WHERE/JOIN/ORDER BY using the md alias.
 */
import type Database from 'better-sqlite3';

export type ExtraKind = 'ontbijt' | 'snack';

/** A breakfast or snack of a week, with what the view needs from its library recipe. */
export interface MenuExtra {
  id: number;
  menu_id: number;
  kind: ExtraKind;
  day_name: string | null;
  date: string | null;
  recipe_id: number;
  recipe_name: string;
  meal_type: string | null;
  prep_time_minutes: number | null;
  recipe_image_version: number | null;
}

/** The breakfasts, then the snacks, of the given menus, in the order planned. */
export function menuExtras(db: Database.Database, menuIds: number[]): MenuExtra[] {
  return db.prepare(`
    SELECT me.id, me.menu_id, me.kind, me.day_name, me.date, me.recipe_id,
           r.name AS recipe_name, r.meal_type, r.prep_time_minutes, r.image_version AS recipe_image_version
    FROM menu_extras me JOIN recipes r ON r.id = me.recipe_id
    WHERE me.menu_id IN (SELECT value FROM json_each(?))
    ORDER BY me.menu_id, me.kind = 'snack', me.position
  `).all(JSON.stringify(menuIds)) as MenuExtra[];
}

export const MENU_DAY_SQL = `
  SELECT md.*, r.image_version AS recipe_image_version
  FROM menu_days md
  LEFT JOIN recipes r ON r.id = md.recipe_id`;

/** Why a new order of a week's dinners was refused; null when it was saved. */
export type ReorderError = 'not_found' | 'invalid' | 'eaten';

/**
 * Puts a week's uneaten dinners on other days. The days themselves stay where
 * they are (date, weekday and name); the dinners move over them: the first of
 * dayIds gets the earliest of their days, the next one the day after, and so
 * on. What was cooked, its rating and notes go along with the dinner.
 * Only the given dinners move, so the eaten days stay as they were.
 */
export function reorderDays(db: Database.Database, menuId: number, dayIds: number[]): ReorderError | null {
  if (!db.prepare('SELECT 1 FROM menus WHERE id = ?').get(menuId)) return 'not_found';
  if (dayIds.length === 0 || new Set(dayIds).size !== dayIds.length) return 'invalid';

  const days = db.prepare(`
    SELECT id, day_of_week, day_name, date, status FROM menu_days
    WHERE menu_id = ? AND id IN (SELECT value FROM json_each(?))
  `).all(menuId, JSON.stringify(dayIds)) as Array<{
    id: number; day_of_week: number; day_name: string; date: string | null; status: string;
  }>;
  if (days.length !== dayIds.length) return 'invalid';
  if (days.some((d) => d.status === 'completed')) return 'eaten';

  const slots = [...days].sort((a, b) =>
    (a.date ?? '').localeCompare(b.date ?? '') || a.day_of_week - b.day_of_week);
  const move = db.prepare('UPDATE menu_days SET day_of_week = ?, day_name = ?, date = ? WHERE id = ?');
  db.transaction(() => {
    dayIds.forEach((id, i) => move.run(slots[i].day_of_week, slots[i].day_name, slots[i].date, id));
  })();
  return null;
}
