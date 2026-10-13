import type Database from 'better-sqlite3';

export type MenuStatus = 'active' | 'archived';

/** A date as YYYY-MM-DD in the server's own time zone (TZ=Europe/Amsterdam in production). */
export function localDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Move every active menu whose last planned day lies before `today` to the
 * archive, also when not every day was ticked off. A menu taken back out of the
 * archive by hand is left alone. Returns how many menus went.
 */
export function archiveFinishedMenus(db: Database.Database, today: string): number {
  return db.prepare(`
    UPDATE menus SET status = 'archived', archived_at = CURRENT_TIMESTAMP
    WHERE status = 'active' AND auto_archive = 1 AND id IN (
      SELECT menu_id FROM menu_days GROUP BY menu_id HAVING MAX(date) < ?
    )
  `).run(today).changes;
}

/**
 * Archive an active menu once every day is ticked off. A menu taken back out
 * of the archive by hand is left alone. Returns whether it went.
 */
export function archiveIfAllEaten(db: Database.Database, id: number): boolean {
  return db.prepare(`
    UPDATE menus SET status = 'archived', archived_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'active' AND auto_archive = 1
      AND NOT EXISTS (SELECT 1 FROM menu_days WHERE menu_id = menus.id AND status != 'completed')
  `).run(id).changes > 0;
}

/**
 * Archive a menu, or take it back out. Taken back out it stays active until it
 * is archived again by hand, even when its week is over.
 */
export function setMenuStatus(db: Database.Database, id: number, status: MenuStatus): boolean {
  const sql = status === 'archived'
    ? "UPDATE menus SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ?"
    : "UPDATE menus SET status = 'active', archived_at = NULL, auto_archive = 0 WHERE id = ?";
  return db.prepare(sql).run(id).changes > 0;
}

export interface ArchivedDay {
  id: number;
  menu_id: number;
  day_name: string;
  date: string | null;
  recipe_id: number | null;
  recipe_name: string;
  meal_type: string;
  status: string;
  recipe_image_version: number | null;
  stars: number | null;
}

export interface ArchivedMenu {
  id: number;
  week_number: number;
  year: number;
  archived_at: string | null;
  first_date: string | null;
  last_date: string | null;
  days: ArchivedDay[];
}

/** Archived menus, newest week first, each with its days and their feedback. */
export function listArchivedMenus(db: Database.Database): ArchivedMenu[] {
  const menus = db.prepare(`
    SELECT m.id, m.week_number, m.year, m.archived_at,
      MIN(md.date) AS first_date, MAX(md.date) AS last_date
    FROM menus m LEFT JOIN menu_days md ON md.menu_id = m.id
    WHERE m.status = 'archived'
    GROUP BY m.id
    ORDER BY m.year DESC, m.week_number DESC
  `).all() as Omit<ArchivedMenu, 'days'>[];

  const days = db.prepare(`
    SELECT md.id, md.menu_id, md.day_name, md.date, md.recipe_id, md.recipe_name, md.meal_type, md.status,
      r.image_version AS recipe_image_version, df.stars
    FROM menu_days md
    JOIN menus m ON m.id = md.menu_id
    LEFT JOIN recipes r ON r.id = md.recipe_id
    LEFT JOIN day_feedback df ON df.day_id = md.id
    WHERE m.status = 'archived'
    ORDER BY md.date, md.day_of_week
  `).all() as ArchivedDay[];

  const byMenu = new Map<number, ArchivedDay[]>();
  for (const d of days) {
    if (!byMenu.has(d.menu_id)) byMenu.set(d.menu_id, []);
    byMenu.get(d.menu_id)!.push(d);
  }
  return menus.map((m) => ({ ...m, days: byMenu.get(m.id) ?? [] }));
}
