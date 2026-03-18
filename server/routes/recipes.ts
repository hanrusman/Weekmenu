import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';

const router = Router();

// GET /api/recipes - list recipes
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { search, tag } = req.query;

  let query = 'SELECT * FROM recipes';
  const params: string[] = [];

  if (search) {
    query += ' WHERE name LIKE ?';
    params.push(`%${search}%`);
  } else if (tag) {
    query += " WHERE tags LIKE ?";
    params.push(`%${tag}%`);
  }

  query += ' ORDER BY times_used DESC, name';
  const recipes = db.prepare(query).all(...params);
  res.json(recipes);
});

// POST /api/recipes - add recipe
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { name, source, recipe_data, tags } = req.body;

  if (!name || !recipe_data) {
    res.status(400).json({ error: 'Naam en recept data zijn verplicht' });
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
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!recipe) {
    res.status(404).json({ error: 'Recept niet gevonden' });
    return;
  }
  res.json(recipe);
});

// DELETE /api/recipes/:id
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
