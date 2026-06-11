import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';

const router = Router();

// GET /api/ingredients - canonical ingredient list with usage counts
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const ingredients = db.prepare(`
    SELECT i.*, COUNT(ri.id) AS recipe_count
    FROM ingredients i
    LEFT JOIN recipe_ingredients ri ON ri.ingredient_id = i.id
    GROUP BY i.id
    ORDER BY i.name
  `).all();
  res.json(ingredients);
});

// PATCH /api/ingredients/:id - fix unit or product group of an ingredient
router.patch('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig ingrediënt ID' });
    return;
  }

  const { unit, product_group } = req.body;
  if (unit === undefined && product_group === undefined) {
    res.status(400).json({ error: 'Geef unit en/of product_group op' });
    return;
  }
  if (unit !== undefined && typeof unit !== 'string') {
    res.status(400).json({ error: 'unit moet een string zijn' });
    return;
  }
  if (product_group !== undefined && typeof product_group !== 'string') {
    res.status(400).json({ error: 'product_group moet een string zijn' });
    return;
  }

  const result = db.prepare(
    'UPDATE ingredients SET unit = COALESCE(?, unit), product_group = COALESCE(?, product_group) WHERE id = ?'
  ).run(unit ?? null, product_group ?? null, id);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Ingrediënt niet gevonden' });
    return;
  }

  res.json(db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id));
});

export default router;
