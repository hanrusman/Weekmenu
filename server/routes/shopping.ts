import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { adminAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/menus/:id/shopping - get shopping list
router.get('/:id/shopping', (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId) || menuId <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }

  const items = db.prepare(
    'SELECT * FROM shopping_items WHERE menu_id = ? ORDER BY product_group, item_name'
  ).all(menuId) as Array<{ product_group: string; [key: string]: unknown }>;

  // Group by product_group
  const grouped: Record<string, typeof items> = {};
  for (const item of items) {
    if (!grouped[item.product_group]) grouped[item.product_group] = [];
    grouped[item.product_group].push(item);
  }

  res.json({ items, grouped });
});

// PATCH /api/menus/:id/shopping/:itemId - toggle item check
router.patch('/:id/shopping/:itemId', adminAuth, (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { checked } = req.body;

  if (typeof checked !== 'boolean') {
    res.status(400).json({ error: 'checked moet een boolean zijn' });
    return;
  }

  const result = db.prepare('UPDATE shopping_items SET checked = ? WHERE id = ? AND menu_id = ?')
    .run(checked ? 1 : 0, itemId, menuId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Item niet gevonden' });
    return;
  }

  const item = db.prepare('SELECT * FROM shopping_items WHERE id = ? AND menu_id = ?').get(itemId, menuId);
  res.json(item);
});

// DELETE /api/menus/:id/shopping - clear all shopping items
router.delete('/:id/shopping', adminAuth, (req: Request, res: Response) => {
  const db = getDb();
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId) || menuId <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return;
  }

  db.prepare('DELETE FROM shopping_items WHERE menu_id = ?').run(menuId);
  res.json({ ok: true });
});

export default router;
