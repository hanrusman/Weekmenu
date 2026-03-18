import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';

const router = Router();

// GET /api/menus/:id/shopping - get shopping list
router.get('/:id/shopping', (req: Request, res: Response) => {
  const db = getDb();
  const items = db.prepare(
    'SELECT * FROM shopping_items WHERE menu_id = ? ORDER BY product_group, item_name'
  ).all(req.params.id);

  // Group by product_group
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    const group = (item as { product_group: string }).product_group;
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(item);
  }

  res.json({ items, grouped });
});

// PATCH /api/menus/:id/shopping/:itemId - toggle item check
router.patch('/:id/shopping/:itemId', (req: Request, res: Response) => {
  const db = getDb();
  const { checked } = req.body;
  db.prepare('UPDATE shopping_items SET checked = ? WHERE id = ? AND menu_id = ?')
    .run(checked ? 1 : 0, req.params.itemId, req.params.id);
  const item = db.prepare('SELECT * FROM shopping_items WHERE id = ?').get(req.params.itemId);
  res.json(item);
});

export default router;
