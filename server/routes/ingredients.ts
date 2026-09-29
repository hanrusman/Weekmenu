import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { regenerateActiveMenus } from '../services/shopping-generator.js';
import {
  IngredientError,
  listIngredients,
  renameIngredient,
  changeIngredientUnit,
  setConversion,
  deleteConversion,
  mergeIngredients,
} from '../services/ingredient-admin.js';

const router = Router();

function parseId(raw: unknown, res: Response): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig ingrediënt ID' });
    return null;
  }
  return id;
}

/** Run a mutation in a transaction, refresh active shopping lists, map domain errors to HTTP. */
function mutate(res: Response, fn: () => unknown): void {
  const db = getDb();
  try {
    const result = db.transaction(fn)();
    regenerateActiveMenus();
    res.json(result ?? { ok: true });
  } catch (err) {
    if (err instanceof IngredientError) {
      res.status(err.status).json({ error: err.message, ...(err.conflictId ? { conflict_id: err.conflictId } : {}) });
      return;
    }
    throw err;
  }
}

// GET /api/ingredients - canonical ingredients with units, conversions, aliases and merge hints
router.get('/', (_req: Request, res: Response) => {
  res.json(listIngredients(getDb()));
});

// PATCH /api/ingredients/:id - rename, change unit or product group
router.patch('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;

  const { name, unit, product_group } = req.body;
  if (name === undefined && unit === undefined && product_group === undefined) {
    res.status(400).json({ error: 'Geef name, unit en/of product_group op' });
    return;
  }
  for (const [key, value] of Object.entries({ name, unit, product_group })) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 100)) {
      res.status(400).json({ error: `${key} moet een string zijn (max 100 tekens)` });
      return;
    }
  }

  mutate(res, () => {
    const db = getDb();
    if (!db.prepare('SELECT id FROM ingredients WHERE id = ?').get(id)) {
      throw new IngredientError('Ingrediënt niet gevonden', 404);
    }
    if (name !== undefined) renameIngredient(db, id, name);
    const conversionsReset = unit !== undefined ? changeIngredientUnit(db, id, unit) : false;
    if (product_group !== undefined) {
      const group = product_group.toLowerCase().trim();
      if (!group) throw new IngredientError('Productgroep mag niet leeg zijn');
      db.prepare('UPDATE ingredients SET product_group = ? WHERE id = ?').run(group, id);
    }
    return { ...(db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id) as object), conversions_reset: conversionsReset };
  });
});

// POST /api/ingredients/:id/merge - merge this ingredient into another ({ into: id })
router.post('/:id/merge', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const into = Number(req.body?.into);
  if (!Number.isInteger(into) || into <= 0) {
    res.status(400).json({ error: 'Geef het doel-ingrediënt op (into)' });
    return;
  }
  mutate(res, () => ({ ok: true, recipe_ids: mergeIngredients(getDb(), id, into) }));
});

// PUT /api/ingredients/:id/conversions - set "1 <unit> = <factor> x ingredient unit"
router.put('/:id/conversions', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const { unit, factor } = req.body ?? {};
  if (typeof unit !== 'string' || unit.length > 30) {
    res.status(400).json({ error: 'unit moet een string zijn' });
    return;
  }
  mutate(res, () => setConversion(getDb(), id, unit, Number(factor)));
});

// DELETE /api/ingredients/:id/conversions/:unit
router.delete('/:id/conversions/:unit', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  mutate(res, () => deleteConversion(getDb(), id, String(req.params.unit)));
});

export default router;
