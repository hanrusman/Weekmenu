import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { getDb, STARS_FROM_RATING } from '../db.js';
import { importMenu, previewMenu, getTargetWeek } from '../services/menu-generator.js';
import { buildPlanningBrief } from '../services/planning.js';
import { MENU_DAY_SQL } from '../services/menu-days.js';
import { generatePantryCheck, generateShoppingList } from '../services/shopping-generator.js';
import { archiveFinishedMenus, archiveIfAllEaten, listArchivedMenus, localDateStr, setMenuStatus, MenuStatus } from '../services/menu-archive.js';

const router = Router();

const VALID_MENU_STATUSES: MenuStatus[] = ['active', 'archived'];

/** Menus with the span of their days and how many were cooked. */
const MENU_SUMMARY_SQL = `
  SELECT m.*, MIN(md.date) AS first_date, MAX(md.date) AS last_date,
    COUNT(md.id) AS day_count, COALESCE(SUM(md.status = 'completed'), 0) AS completed_count
  FROM menus m LEFT JOIN menu_days md ON md.menu_id = m.id`;

/** Weeks that are over leave the active list before it is read. */
function archiveFinished() {
  const archived = archiveFinishedMenus(getDb(), localDateStr(new Date()));
  if (archived > 0) console.log(`Archived ${archived} finished menu(s)`);
}

// GET /api/menus - list all menus
router.get('/', (_req: Request, res: Response) => {
  archiveFinished();
  const db = getDb();
  const menus = db.prepare(`${MENU_SUMMARY_SQL} GROUP BY m.id ORDER BY m.year DESC, m.week_number DESC`).all();
  res.json(menus);
});

// GET /api/menus/active-list - list all active menus (for week navigation)
router.get('/active-list', (_req: Request, res: Response) => {
  archiveFinished();
  const db = getDb();
  const menus = db.prepare(`${MENU_SUMMARY_SQL} WHERE m.status = 'active' GROUP BY m.id ORDER BY m.year, m.week_number`).all();
  res.json(menus);
});

// GET /api/menus/archive - archived weeks with their days and feedback, newest first
router.get('/archive', (_req: Request, res: Response) => {
  archiveFinished();
  res.json(listArchivedMenus(getDb()));
});

// GET /api/menus/active - get all active menus' days as a rolling calendar
router.get('/active', (_req: Request, res: Response) => {
  archiveFinished();
  const db = getDb();
  const menus = db.prepare("SELECT * FROM menus WHERE status = 'active' ORDER BY year, week_number").all() as Array<{ id: number; week_number: number; year: number }>;
  if (menus.length === 0) {
    res.json(null);
    return;
  }

  // Collect all days from all active menus, sorted by date
  const days = db.prepare(`
    SELECT md.*, r.image_version AS recipe_image_version, m.week_number, df.stars
    FROM menu_days md
    LEFT JOIN recipes r ON r.id = md.recipe_id
    LEFT JOIN day_feedback df ON df.day_id = md.id
    JOIN menus m ON md.menu_id = m.id
    WHERE m.status = 'active'
    ORDER BY md.date, md.day_of_week
  `).all();

  // Collect snack suggestions from all active menus
  const allSnacks: string[] = [];
  for (const m of menus) {
    const menu = db.prepare('SELECT snack_suggestions FROM menus WHERE id = ?').get(m.id) as { snack_suggestions: string | null };
    if (menu.snack_suggestions) {
      try {
        const snacks = JSON.parse(menu.snack_suggestions) as string[];
        for (const s of snacks) {
          if (!allSnacks.includes(s)) allSnacks.push(s);
        }
      } catch { /* ignore */ }
    }
  }

  // Return combined view
  res.json({
    id: menus[0].id,
    week_number: menus[0].week_number,
    year: menus[0].year,
    status: 'active',
    snack_suggestions: JSON.stringify(allSnacks),
    days,
  });
});

// GET /api/menus/feedback/export - export recent feedback as text for Claude conversation
// NOTE: defined before /:id so "feedback" doesn't match the :id param
router.get('/feedback/export', (_req: Request, res: Response) => {
  const db = getDb();

  const feedback = db.prepare(`
    SELECT m.week_number, m.year, md.day_name, md.recipe_name, md.meal_type, df.stars, df.notes
    FROM day_feedback df
    JOIN menu_days md ON df.day_id = md.id
    JOIN menus m ON md.menu_id = m.id
    ORDER BY m.year DESC, m.week_number DESC, md.day_of_week
    LIMIT 30
  `).all() as Array<{
    week_number: number; year: number; day_name: string;
    recipe_name: string; meal_type: string; stars: number; notes: string | null;
  }>;

  if (feedback.length === 0) {
    res.json({ text: 'Nog geen feedback beschikbaar.', feedback: [] });
    return;
  }

  let text = 'Feedback van afgelopen weken:\n\n';
  let currentWeek = '';

  for (const f of feedback) {
    const weekLabel = `Week ${f.week_number}, ${f.year}`;
    if (weekLabel !== currentWeek) {
      currentWeek = weekLabel;
      text += `### ${weekLabel}\n`;
    }
    text += `- ${f.day_name}: ${f.recipe_name} (${f.meal_type}) — ${f.stars}/5 sterren`;
    if (f.notes) text += ` — "${f.notes}"`;
    text += '\n';
  }

  res.json({ text, feedback });
});

// GET /api/menus/planning-brief - approved recipes, recent menus, feedback and the
// import format, as text to paste into a Claude conversation
router.get('/planning-brief', (_req: Request, res: Response) => {
  res.json(buildPlanningBrief(getDb()));
});

// GET /api/menus/target-week - get the auto-detected target week info
router.get('/target-week', (_req: Request, res: Response) => {
  const target = getTargetWeek(new Date());
  res.json(target);
});

/** The menu, week and year of an import request, or the reason they are unusable. */
function importInput(body: unknown): { menu: unknown; weekNumber?: number; year?: number } | { error: string } {
  const { menu, weekNumber, year } = (body || {}) as { menu?: unknown; weekNumber?: number; year?: number };
  if (!menu) return { error: 'Menu JSON is vereist' };
  if (weekNumber !== undefined && (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53)) {
    return { error: 'Weeknummer moet tussen 1 en 53 zijn' };
  }
  if (year !== undefined && (!Number.isInteger(year) || year < 2020 || year > 2100)) {
    return { error: 'Jaar moet tussen 2020 en 2100 zijn' };
  }
  return { menu, weekNumber, year };
}

function importError(res: Response, err: unknown) {
  let message = (err as Error).message;
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    message = `${issue.path.join('.') || 'menu'}: ${issue.message}`;
  }
  res.status(400).json({ error: `Menu import mislukt — ${message}`, details: (err as Error).message });
}

// POST /api/menus/preview - what importing would give, without storing anything
router.post('/preview', (req: Request, res: Response) => {
  const input = importInput(req.body);
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  try {
    res.json(previewMenu(input.menu, input.weekNumber, input.year));
  } catch (err) {
    importError(res, err);
  }
});

// POST /api/menus/import - import a menu from JSON (admin only)
router.post('/import', (req: Request, res: Response) => {
  const input = importInput(req.body);
  if ('error' in input) {
    res.status(400).json(input);
    return;
  }
  try {
    const menuId = importMenu(input.menu, input.weekNumber, input.year);
    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
    const days = db.prepare(`${MENU_DAY_SQL} WHERE md.menu_id = ? ORDER BY md.day_of_week`).all(menuId);
    res.json({ ...menu as object, days });
  } catch (err) {
    console.error('Menu import failed:', err);
    importError(res, err);
  }
});

// GET /api/menus/:id - get specific menu with days
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }
  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
  if (!menu) {
    res.status(404).json({ error: 'Menu niet gevonden' });
    return;
  }
  const days = db.prepare(`${MENU_DAY_SQL} WHERE md.menu_id = ? ORDER BY md.day_of_week`).all(id);
  res.json({ ...menu as object, days });
});

// PATCH /api/menus/:id - update menu status (admin only)
router.patch('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  const { status } = req.body;

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }
  if (!VALID_MENU_STATUSES.includes(status)) {
    res.status(400).json({ error: `Status moet een van ${VALID_MENU_STATUSES.join(', ')} zijn` });
    return;
  }

  if (!setMenuStatus(db, id, status)) {
    res.status(404).json({ error: 'Menu niet gevonden' });
    return;
  }

  if (status === 'active') {
    try { generatePantryCheck(id); } catch (err) { console.error('Pantry check generation failed:', err); }
  }

  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
  const days = db.prepare(`${MENU_DAY_SQL} WHERE md.menu_id = ? ORDER BY md.day_of_week`).all(id);
  res.json({ ...menu as object, days });
});

// DELETE /api/menus/:id - delete a menu (admin only)
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }

  const result = db.prepare('DELETE FROM menus WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Menu niet gevonden' });
    return;
  }

  res.json({ ok: true });
});

// GET /api/menus/:id/days - get all days for a menu
router.get('/:id/days', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }
  const days = db.prepare(`${MENU_DAY_SQL} WHERE md.menu_id = ? ORDER BY md.day_of_week`).all(id);
  res.json(days);
});

// DELETE /api/menus/:id/days/:dayId - remove a day from a menu (admin only)
router.delete('/:id/days/:dayId', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const dayId = Number(req.params.dayId);

  const result = db.prepare('DELETE FROM menu_days WHERE id = ? AND menu_id = ?').run(dayId, menuId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Dag niet gevonden' });
    return;
  }

  // Recompute shopping list and pantry check after removing a day
  try { generateShoppingList(menuId); } catch (err) { console.error('Shopping list failed:', err); }
  try { generatePantryCheck(menuId); } catch (err) { console.error('Pantry check failed:', err); }

  res.json({ ok: true });
});

// PATCH /api/menus/:id/days/:dayId/complete - mark meal as done
router.patch('/:id/days/:dayId/complete', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const dayId = Number(req.params.dayId);

  const result = db.prepare(
    "UPDATE menu_days SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND menu_id = ?"
  ).run(dayId, menuId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Dag niet gevonden' });
    return;
  }

  try { generatePantryCheck(menuId); } catch (err) { console.error('Pantry check failed:', err); }

  archiveIfAllEaten(db, menuId);

  const day = db.prepare(`${MENU_DAY_SQL} WHERE md.id = ? AND md.menu_id = ?`).get(dayId, menuId);
  res.json(day);
});

// POST /api/menus/:id/days/:dayId/feedback - save feedback for a day
router.post('/:id/days/:dayId/feedback', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const dayId = Number(req.params.dayId);
  const { notes } = req.body;
  // An app still open from before the stars sends lekker / ok / minder
  const stars = typeof req.body.rating === 'string' && req.body.stars === undefined
    ? STARS_FROM_RATING[req.body.rating]
    : req.body.stars;

  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    res.status(400).json({ error: 'Geef 1 tot 5 sterren' });
    return;
  }
  if (notes && typeof notes === 'string' && notes.length > 500) {
    res.status(400).json({ error: 'Notities mogen maximaal 500 tekens zijn' });
    return;
  }

  const day = db.prepare('SELECT id FROM menu_days WHERE id = ? AND menu_id = ?').get(dayId, menuId);
  if (!day) {
    res.status(404).json({ error: 'Dag niet gevonden' });
    return;
  }

  db.prepare(`
    INSERT INTO day_feedback (day_id, stars, notes) VALUES (?, ?, ?)
    ON CONFLICT(day_id) DO UPDATE SET stars = excluded.stars, notes = excluded.notes, created_at = CURRENT_TIMESTAMP
  `).run(dayId, stars, notes || null);

  const feedback = db.prepare('SELECT * FROM day_feedback WHERE day_id = ?').get(dayId);
  res.json(feedback);
});

// GET /api/menus/:id/days/:dayId/feedback - get feedback for a day
router.get('/:id/days/:dayId/feedback', (req: Request, res: Response) => {
  const dayId = Number(req.params.dayId);
  const db = getDb();
  const feedback = db.prepare('SELECT * FROM day_feedback WHERE day_id = ?').get(dayId);
  res.json(feedback || null);
});

// GET /api/menus/:id/feedback - get all feedback for a menu
router.get('/:id/feedback', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);

  const feedback = db.prepare(`
    SELECT md.day_name, md.recipe_name, md.meal_type, df.stars, df.notes
    FROM day_feedback df
    JOIN menu_days md ON df.day_id = md.id
    WHERE md.menu_id = ?
    ORDER BY md.day_of_week
  `).all(menuId);

  res.json(feedback);
});

export default router;
