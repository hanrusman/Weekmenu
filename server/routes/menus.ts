import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { generateMenu, regenerateDay } from '../services/menu-generator.js';
import { generatePantryCheck } from '../services/shopping-generator.js';
import { adminAuth } from '../middleware/auth.js';

const router = Router();

const VALID_MENU_STATUSES = ['draft', 'active', 'archived'];
const VALID_DAY_STATUSES = ['proposed', 'approved', 'modified', 'completed'];

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

// POST /api/menus/generate - generate new menu (admin only)
router.post('/generate', adminAuth, async (req: Request, res: Response) => {
  try {
    const { weekNumber, year, preferences } = req.body || {};

    // Validate inputs
    if (weekNumber !== undefined && (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 53)) {
      res.status(400).json({ error: 'Weeknummer moet tussen 1 en 53 zijn' });
      return;
    }
    if (year !== undefined && (!Number.isInteger(year) || year < 2020 || year > 2100)) {
      res.status(400).json({ error: 'Jaar moet tussen 2020 en 2100 zijn' });
      return;
    }

    const menuId = await generateMenu(weekNumber, year, preferences);
    const db = getDb();
    const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(menuId);
    const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(menuId);
    res.json({ ...menu as object, days });
  } catch (err) {
    console.error('Menu generation failed:', err);
    res.status(500).json({ error: 'Menu generatie mislukt', details: (err as Error).message });
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

  // Check menu exists
  const existing = db.prepare('SELECT id FROM menus WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Menu niet gevonden' });
    return;
  }

  // Use transaction for atomic activation
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

// PATCH /api/menus/:id/days/:dayId - approve/modify a day (admin only)
router.patch('/:id/days/:dayId', adminAuth, (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const dayId = Number(req.params.dayId);
  const { status, notes } = req.body;

  if (!VALID_DAY_STATUSES.includes(status)) {
    res.status(400).json({ error: `Status moet een van ${VALID_DAY_STATUSES.join(', ')} zijn` });
    return;
  }
  if (notes && typeof notes === 'string' && notes.length > 1000) {
    res.status(400).json({ error: 'Notities mogen maximaal 1000 tekens zijn' });
    return;
  }

  const result = db.prepare('UPDATE menu_days SET status = ?, notes = ? WHERE id = ? AND menu_id = ?')
    .run(status, notes || null, dayId, menuId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Dag niet gevonden' });
    return;
  }

  const day = db.prepare('SELECT * FROM menu_days WHERE id = ? AND menu_id = ?').get(dayId, menuId);
  res.json(day);
});

// POST /api/menus/:id/days/:dayId/regenerate - regenerate a single day (admin only)
router.post('/:id/days/:dayId/regenerate', adminAuth, async (req: Request, res: Response) => {
  try {
    const menuId = Number(req.params.id);
    const dayId = Number(req.params.dayId);
    await regenerateDay(menuId, dayId);
    const db = getDb();
    const day = db.prepare('SELECT * FROM menu_days WHERE id = ? AND menu_id = ?').get(dayId, menuId);
    res.json(day);
  } catch (err) {
    console.error('Day regeneration failed:', err);
    res.status(500).json({ error: 'Dag regeneratie mislukt', details: (err as Error).message });
  }
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

export { safeJsonParse };
export default router;
