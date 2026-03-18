import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { generateMenu, regenerateDay } from '../services/menu-generator.js';
import { generatePantryCheck } from '../services/shopping-generator.js';

const router = Router();

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

// POST /api/menus/generate - generate new menu
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const { weekNumber, year, preferences } = req.body || {};
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
  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(req.params.id);
  if (!menu) {
    res.status(404).json({ error: 'Menu niet gevonden' });
    return;
  }
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(req.params.id);
  res.json({ ...menu as object, days });
});

// PATCH /api/menus/:id - update menu status
router.patch('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const { status } = req.body;

  if (status === 'active') {
    // Deactivate any current active menu
    db.prepare("UPDATE menus SET status = 'archived' WHERE status = 'active'").run();
    // Generate pantry check when activating
    generatePantryCheck(Number(req.params.id));
  }

  db.prepare('UPDATE menus SET status = ? WHERE id = ?').run(status, req.params.id);
  const menu = db.prepare('SELECT * FROM menus WHERE id = ?').get(req.params.id);
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(req.params.id);
  res.json({ ...menu as object, days });
});

// GET /api/menus/:id/days - get all days for a menu
router.get('/:id/days', (req: Request, res: Response) => {
  const db = getDb();
  const days = db.prepare('SELECT * FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(req.params.id);
  res.json(days);
});

// PATCH /api/menus/:id/days/:dayId - approve/modify a day
router.patch('/:id/days/:dayId', (req: Request, res: Response) => {
  const db = getDb();
  const { status, notes } = req.body;
  db.prepare('UPDATE menu_days SET status = ?, notes = ? WHERE id = ? AND menu_id = ?')
    .run(status, notes || null, req.params.dayId, req.params.id);
  const day = db.prepare('SELECT * FROM menu_days WHERE id = ?').get(req.params.dayId);
  res.json(day);
});

// POST /api/menus/:id/days/:dayId/regenerate - regenerate a single day
router.post('/:id/days/:dayId/regenerate', async (req: Request, res: Response) => {
  try {
    await regenerateDay(Number(req.params.id), Number(req.params.dayId));
    const db = getDb();
    const day = db.prepare('SELECT * FROM menu_days WHERE id = ?').get(req.params.dayId);
    res.json(day);
  } catch (err) {
    console.error('Day regeneration failed:', err);
    res.status(500).json({ error: 'Dag regeneratie mislukt', details: (err as Error).message });
  }
});

// PATCH /api/menus/:id/days/:dayId/complete - mark meal as done
router.patch('/:id/days/:dayId/complete', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare(
    "UPDATE menu_days SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND menu_id = ?"
  ).run(req.params.dayId, req.params.id);

  // Refresh pantry check
  generatePantryCheck(Number(req.params.id));

  const day = db.prepare('SELECT * FROM menu_days WHERE id = ?').get(req.params.dayId);
  res.json(day);
});

export default router;
