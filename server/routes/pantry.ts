import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';

const router = Router();

// GET /api/menus/:id/pantry - pantry check
router.get('/:id/pantry', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId) || menuId <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }
  const items = db.prepare(
    'SELECT * FROM pantry_check WHERE menu_id = ? ORDER BY item_name'
  ).all(menuId);
  res.json(items);
});

// PATCH /api/menus/:id/pantry/:itemId - toggle have_it
router.patch('/:id/pantry/:itemId', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { have_it } = req.body;

  if (typeof have_it !== 'boolean') {
    res.status(400).json({ error: 'have_it moet een boolean zijn' });
    return;
  }

  const result = db.prepare('UPDATE pantry_check SET have_it = ? WHERE id = ? AND menu_id = ?')
    .run(have_it ? 1 : 0, itemId, menuId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Item niet gevonden' });
    return;
  }

  const item = db.prepare('SELECT * FROM pantry_check WHERE id = ? AND menu_id = ?').get(itemId, menuId);
  res.json(item);
});

export default router;
