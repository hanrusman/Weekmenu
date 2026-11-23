// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.DATABASE_PATH = ':memory:';
const { default: router } = await import('../server/routes/menus');
const { csrfGuard, requireAuth } = await import('../server/middleware/auth');
const { createSession } = await import('../server/services/auth');
const { getDb, closeDb } = await import('../server/db');
const { reorderDays } = await import('../server/services/menu-days');

const NAMES = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag'];

/** A week from Monday 23 November, one dinner a day; returns the menu and its day ids. */
function week(weekNumber = 48, statuses = ['completed', 'approved', 'approved', 'approved']) {
  const db = getDb();
  const menuId = Number(db.prepare("INSERT INTO menus (week_number, year, status) VALUES (?, 2026, 'active')").run(weekNumber).lastInsertRowid);
  const ids = statuses.map((status, i) => Number(db.prepare(`
    INSERT INTO menu_days (menu_id, day_of_week, day_name, date, recipe_name, recipe_data, meal_type, status)
    VALUES (?, ?, ?, ?, ?, '{}', 'pasta', ?)
  `).run(menuId, i, NAMES[i], `2026-11-${23 + i}`, `Gerecht ${i}`, status).lastInsertRowid));
  return { menuId, ids };
}

function plan(menuId: number) {
  return getDb().prepare('SELECT id, recipe_name, day_of_week, day_name, date FROM menu_days WHERE menu_id = ? ORDER BY date')
    .all(menuId) as Array<{ id: number; recipe_name: string; day_of_week: number; day_name: string; date: string }>;
}

let server: Server;
let base: string;
let cookie: string;

beforeAll(async () => {
  getDb().prepare("INSERT INTO users (id, email, password_hash) VALUES (1, 'reorder-test@example.nl', 'unused')").run();
  cookie = `weekmenu_session=${createSession(1).token}`;
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api', csrfGuard, requireAuth);
  app.use('/api/menus', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/menus`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
});

beforeEach(() => {
  getDb().exec('DELETE FROM menu_days; DELETE FROM menus;');
});

function put(menuId: number, body: unknown) {
  return fetch(`${base}/${menuId}/days/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base.replace(/\/api.*/, '') },
    body: JSON.stringify(body),
  });
}

describe('Moving dinners to other days', () => {
  it('moves the dinners over the days, which stay where they are; eaten days stay put', () => {
    const { menuId, ids } = week();
    getDb().prepare('INSERT INTO day_feedback (day_id, stars) VALUES (?, 4)').run(ids[3]);

    // Thursday's dinner first, then Tuesday's, then Wednesday's
    expect(reorderDays(getDb(), menuId, [ids[3], ids[1], ids[2]])).toBeNull();

    expect(plan(menuId)).toEqual([
      { id: ids[0], recipe_name: 'Gerecht 0', day_of_week: 0, day_name: 'Maandag', date: '2026-11-23' },
      { id: ids[3], recipe_name: 'Gerecht 3', day_of_week: 1, day_name: 'Dinsdag', date: '2026-11-24' },
      { id: ids[1], recipe_name: 'Gerecht 1', day_of_week: 2, day_name: 'Woensdag', date: '2026-11-25' },
      { id: ids[2], recipe_name: 'Gerecht 2', day_of_week: 3, day_name: 'Donderdag', date: '2026-11-26' },
    ]);
    // The rating goes along with the dinner
    expect(getDb().prepare('SELECT day_id FROM day_feedback').get()).toEqual({ day_id: ids[3] });
  });

  it('swaps two dinners and leaves the rest alone', () => {
    const { menuId, ids } = week();
    expect(reorderDays(getDb(), menuId, [ids[3], ids[1]])).toBeNull();
    expect(plan(menuId).map((d) => d.recipe_name)).toEqual(['Gerecht 0', 'Gerecht 3', 'Gerecht 2', 'Gerecht 1']);
  });

  it('refuses eaten days, days of another menu and doubles', () => {
    const { menuId, ids } = week();
    const other = week(49);
    expect(reorderDays(getDb(), menuId, [ids[0], ids[1]])).toBe('eaten');
    expect(reorderDays(getDb(), menuId, [ids[1], other.ids[2]])).toBe('invalid');
    expect(reorderDays(getDb(), menuId, [ids[1], ids[1]])).toBe('invalid');
    expect(reorderDays(getDb(), menuId, [])).toBe('invalid');
    expect(reorderDays(getDb(), 9999, [ids[1]])).toBe('not_found');
    expect(plan(menuId).map((d) => d.recipe_name)).toEqual(['Gerecht 0', 'Gerecht 1', 'Gerecht 2', 'Gerecht 3']);
  });

  it('saves the new order over the API and answers with the week by date', async () => {
    const { menuId, ids } = week();
    const res = await put(menuId, { dayIds: [ids[2], ids[1], ids[3]] });
    expect(res.status).toBe(200);
    const days = await res.json() as Array<{ id: number; day_name: string }>;
    expect(days.map((d) => [d.id, d.day_name])).toEqual([
      [ids[0], 'Maandag'], [ids[2], 'Dinsdag'], [ids[1], 'Woensdag'], [ids[3], 'Donderdag'],
    ]);
  });

  it('says why an order is refused', async () => {
    const { menuId, ids } = week();
    expect((await put(menuId, { dayIds: 'nee' })).status).toBe(400);
    const eaten = await put(menuId, { dayIds: [ids[0], ids[1]] });
    expect(eaten.status).toBe(400);
    expect(await eaten.json()).toEqual({ error: 'Een gegeten dag schuift niet meer mee' });
    expect((await put(9999, { dayIds: [ids[1]] })).status).toBe(404);
  });
});
