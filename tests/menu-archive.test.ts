import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-menu-archive.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { archiveFinishedMenus, setMenuStatus, listArchivedMenus, localDateStr } = await import('../server/services/menu-archive');

/** A menu with one day per date; returns its id. */
function menu(week: number, dates: string[], status = 'active') {
  const db = getDb();
  const id = Number(db.prepare('INSERT INTO menus (week_number, year, status) VALUES (?, 2026, ?)').run(week, status).lastInsertRowid);
  dates.forEach((date, i) => {
    db.prepare(`
      INSERT INTO menu_days (menu_id, day_of_week, day_name, date, recipe_name, recipe_data, meal_type)
      VALUES (?, ?, 'Donderdag', ?, ?, '{}', 'soep')
    `).run(id, i, date, `Gerecht ${week}-${i}`);
  });
  return id;
}

function statusOf(id: number) {
  return getDb().prepare('SELECT status, archived_at, auto_archive FROM menus WHERE id = ?').get(id) as {
    status: string; archived_at: string | null; auto_archive: number;
  };
}

describe('Menu archive', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM day_feedback; DELETE FROM menu_days; DELETE FROM menus;');
  });

  it('archives a week once its last day is past, also with days left unticked', () => {
    const past = menu(40, ['2026-10-01', '2026-10-07']);
    const running = menu(41, ['2026-10-08', '2026-10-14']);

    expect(archiveFinishedMenus(getDb(), '2026-10-08')).toBe(1);
    expect(statusOf(past).status).toBe('archived');
    expect(statusOf(past).archived_at).not.toBeNull();
    expect(statusOf(running).status).toBe('active');
  });

  it('keeps a week active on its own last day', () => {
    const id = menu(41, ['2026-10-08', '2026-10-14']);
    archiveFinishedMenus(getDb(), '2026-10-14');
    expect(statusOf(id).status).toBe('active');
  });

  it('leaves a week taken back out of the archive alone until it is archived by hand', () => {
    const id = menu(40, ['2026-10-01', '2026-10-07']);
    archiveFinishedMenus(getDb(), '2026-10-08');

    setMenuStatus(getDb(), id, 'active');
    expect(statusOf(id)).toMatchObject({ status: 'active', archived_at: null, auto_archive: 0 });
    expect(archiveFinishedMenus(getDb(), '2026-10-20')).toBe(0);
    expect(statusOf(id).status).toBe('active');

    setMenuStatus(getDb(), id, 'archived');
    expect(statusOf(id).status).toBe('archived');
  });

  it('reports a menu that does not exist', () => {
    expect(setMenuStatus(getDb(), 999, 'archived')).toBe(false);
  });

  it('lists archived weeks newest first with their days and feedback', () => {
    const older = menu(39, ['2026-09-24', '2026-09-25'], 'archived');
    const newer = menu(40, ['2026-10-01'], 'archived');
    menu(41, ['2026-10-08']);
    const db = getDb();
    const dayId = (db.prepare('SELECT id FROM menu_days WHERE menu_id = ? ORDER BY date LIMIT 1').get(older) as { id: number }).id;
    db.prepare('INSERT INTO day_feedback (day_id, stars) VALUES (?, 5)').run(dayId);

    const archive = listArchivedMenus(db);
    expect(archive.map((m) => m.id)).toEqual([newer, older]);
    expect(archive[1]).toMatchObject({ first_date: '2026-09-24', last_date: '2026-09-25' });
    expect(archive[1].days.map((d) => d.stars)).toEqual([5, null]);
    expect(archive[0].days).toHaveLength(1);
  });

  it('writes the date in local time', () => {
    expect(localDateStr(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
