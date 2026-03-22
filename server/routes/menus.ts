import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { importMenu, getTargetWeek } from '../services/menu-generator.js';
import { generatePantryCheck } from '../services/shopping-generator.js';
import { adminAuth } from '../middleware/auth.js';

const router = Router();

const VALID_MENU_STATUSES = ['active', 'archived'];
const VALID_RATINGS = ['lekker', 'ok', 'minder'];

function safeJsonParse(str: string | null, fallback: unknown = null): unknown {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// GET /api/menus - list all menus
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const menus = db.prepare('SELECT * FROM menus ORDER BY year DESC, week_number DESC').all();
  res.json(menus);
});

// GET /api/menus/active - get currently active menu
router.get('/active', (_req: Request, res: Response) => {
  const db = getDb();
  const menu = db.prepare("SELECT * FROM menus WHERE status = 'active' ORDER BY id DESC LIMIT 1").get();
  if (!menu) {
    res.json(null);
    return;
  }
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all((menu as { id: number }).id);
  res.json({ ...menu as object, days });
});

// GET /api/menus/feedback/export - export recent feedback as text for Claude conversation
// NOTE: defined before /:id so "feedback" doesn't match the :id param
router.get('/feedback/export', (_req: Request, res: Response) => {
  const db = getDb();

  const feedback = db.prepare(`
    SELECT m.week_number, m.year, md.day_name, md.recipe_name, md.meal_type, df.rating, df.notes
    FROM day_feedback df
    JOIN menu_days md ON df.day_id = md.id
    JOIN menus m ON md.menu_id = m.id
    ORDER BY m.year DESC, m.week_number DESC, md.day_of_week
    LIMIT 30
  `).all() as Array<{
    week_number: number; year: number; day_name: string;
    recipe_name: string; meal_type: string; rating: string; notes: string | null;
  }>;

  if (feedback.length === 0) {
    res.json({ text: 'Nog geen feedback beschikbaar.', feedback: [] });
    return;
  }

  const ratingLabel: Record<string, string> = { lekker: 'Lekker', ok: 'OK', minder: 'Minder' };

  let text = 'Feedback van afgelopen weken:\n\n';
  let currentWeek = '';

  for (const f of feedback) {
    const weekLabel = `Week ${f.week_number}, ${f.year}`;
    if (weekLabel !== currentWeek) {
      currentWeek = weekLabel;
      text += `### ${weekLabel}\n`;
    }
    text += `- ${f.day_name}: ${f.recipe_name} (${f.meal_type}) — ${ratingLabel[f.rating] || f.rating}`;
    if (f.notes) text += ` — "${f.notes}"`;
    text += '\n';
  }

  res.json({ text, feedback });
});

// GET /api/menus/target-week - get the auto-detected target week info
router.get('/target-week', (_req: Request, res: Response) => {
  const target = getTargetWeek(new Date());
  res.json(target);
});

// POST /api/menus/import - import a menu from JSON (admin only)
router.post('/import', adminAuth, (req: Request, res: Response) => {
  try {
    const { menu: menuData, weekNumber, year } = req.body || {};

    if (!menuData) {
      res.status(400).json({ error: 'Menu JSON is vereist' });
      return;
    }

    // Validate optional inputs
    if (weekNumber !== undefined && (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53)) {
      res.status(400).json({ error: 'Weeknummer moet tussen 1 en 53 zijn' });
      return;
    }
    if (year !== undefined && (!Number.isInteger(year) || year < 2020 || year > 2100)) {
      res.status(400).json({ error: 'Jaar moet tussen 2020 en 2100 zijn' });
      return;
    }

    const menuId = importMenu(menuData, weekNumber, year);
    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(menuId);
    res.json({ ...menu as object, days });
  } catch (err) {
    console.error('Menu import failed:', err);
    res.status(400).json({ error: 'Menu import mislukt', details: (err as Error).message });
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
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(id);
  res.json({ ...menu as object, days });
});

// PATCH /api/menus/:id - update menu status (admin only)
router.patch('/:id', adminAuth, (req: Request, res: Response) => {
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

  const existing = db.prepare('SELECT id FROM menus WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Menu niet gevonden' });
    return;
  }

  if (status === 'active') {
    const activate = db.transaction(() => {
      db.prepare("UPDATE menus SET status = 'archived' WHERE status = 'active'").run();
      db.prepare('UPDATE menus SET status = ? WHERE id = ?').run(status, id);
    });
    activate();
    try { generatePantryCheck(id); } catch (err) { console.error('Pantry check generation failed:', err); }
  } else {
    db.prepare('UPDATE menus SET status = ? WHERE id = ?').run(status, id);
  }

  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(id);
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(id);
  res.json({ ...menu as object, days });
});

// DELETE /api/menus/:id - delete a menu (admin only)
router.delete('/:id', adminAuth, (req: Request, res: Response) => {
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
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(id);
  res.json(days);
});

// DELETE /api/menus/:id/days/:dayId - remove a day from a menu (admin only)
router.delete('/:id/days/:dayId', adminAuth, (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const dayId = Number(req.params.dayId);

  const result = db.prepare('DELETE FROM menu_days WHERE id = ? AND menu_id = ?').run(dayId, menuId);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Dag niet gevonden' });
    return;
  }

  // Regenerate pantry check after removing a day
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

  const day = db.prepare('SELECT * FROM menu_days WHERE id = ? AND menu_id = ?').get(dayId, menuId);
  res.json(day);
});

// POST /api/menus/:id/days/:dayId/feedback - save feedback for a day
router.post('/:id/days/:dayId/feedback', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const dayId = Number(req.params.dayId);
  const { rating, notes } = req.body;

  if (!VALID_RATINGS.includes(rating)) {
    res.status(400).json({ error: `Beoordeling moet een van ${VALID_RATINGS.join(', ')} zijn` });
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
    INSERT INTO day_feedback (day_id, rating, notes) VALUES (?, ?, ?)
    ON CONFLICT(day_id) DO UPDATE SET rating = excluded.rating, notes = excluded.notes, created_at = CURRENT_TIMESTAMP
  `).run(dayId, rating, notes || null);

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
    SELECT md.day_name, md.recipe_name, md.meal_type, df.rating, df.notes
    FROM day_feedback df
    JOIN menu_days md ON df.day_id = md.id
    WHERE md.menu_id = ?
    ORDER BY md.day_of_week
  `).all(menuId);

  res.json(feedback);
});

export { safeJsonParse };
export default router;
