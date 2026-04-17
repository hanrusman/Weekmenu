import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { adminAuth } from '../middleware/auth.js';
import { adminRateLimit } from '../middleware/rate-limit.js';

const router = Router();

// GET /api/recipes - list recipes
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { search, tag } = req.query;

  let query = 'SELECT * FROM recipes';
  const params: string[] = [];

  if (search && typeof search === 'string') {
    query += ' WHERE name LIKE ?';
    params.push(`%${search}%`);
  } else if (tag && typeof tag === 'string') {
    query += " WHERE tags LIKE ?";
    params.push(`%${tag}%`);
  }

  query += ' ORDER BY times_used DESC, name';
  const recipes = db.prepare(query).all(...params);
  res.json(recipes);
});

// POST /api/recipes - add recipe
router.post('/', adminRateLimit, adminAuth, (req: Request, res: Response) => {
  const db = getDb();
  const { name, source, recipe_data, tags } = req.body;

  if (!name || typeof name !== 'string' || name.length > 200) {
    res.status(400).json({ error: 'Naam is verplicht (max 200 tekens)' });
    return;
  }
  if (!recipe_data || typeof recipe_data !== 'object') {
    res.status(400).json({ error: 'Recept data is verplicht' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO recipes (name, source, recipe_data, tags) VALUES (?, ?, ?, ?)'
  ).run(name, source || 'manual', JSON.stringify(recipe_data), JSON.stringify(tags || []));

  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(recipe);
});

// GET /api/recipes/:id
router.get('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig recept ID' });
    return;
  }
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  if (!recipe) {
    res.status(404).json({ error: 'Recept niet gevonden' });
    return;
  }
  res.json(recipe);
});

// DELETE /api/recipes/:id
router.delete('/:id', adminRateLimit, adminAuth, (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig recept ID' });
    return;
  }
  const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Recept niet gevonden' });
    return;
  }
  res.json({ ok: true });
});

export default router;
