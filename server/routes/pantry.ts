import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';

const router = Router();

// GET /api/menus/:id/pantry - pantry check
router.get('/:id/pantry', (req: Request, res: Response) => {
  const db = getDb();
  const items = db.prepare(
    'SELECT * FROM pantry_check WHERE menu_id = ? ORDER BY item_name'
  ).all(req.params.id);
  res.json(items);
});

// PATCH /api/menus/:id/pantry/:itemId - toggle have_it
router.patch('/:id/pantry/:itemId', (req: Request, res: Response) => {
  const db = getDb();
  const { have_it } = req.body;
  db.prepare('UPDATE pantry_check SET have_it = ? WHERE id = ? AND menu_id = ?')
    .run(have_it ? 1 : 0, req.params.itemId, req.params.id);
  const item = db.prepare('SELECT * FROM pantry_check WHERE id = ?').get(req.params.itemId);
  res.json(item);
});

export default router;
