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
