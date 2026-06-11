import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { syncRecipeIngredients, RawIngredient } from '../services/ingredients.js';
import { generateShoppingList, generatePantryCheck } from '../services/shopping-generator.js';

const router = Router();

/** Recompute shopping list + pantry check of active menus that use this recipe. */
function regenerateActiveMenusForRecipe(recipeId: number) {
  const db = getDb();
  const menus = db.prepare(`
    SELECT DISTINCT m.id FROM menus m
    JOIN menu_days md ON md.menu_id = m.id
    WHERE m.status = 'active' AND md.recipe_id = ?
  `).all(recipeId) as Array<{ id: number }>;

  for (const menu of menus) {
    try {
      generateShoppingList(menu.id);
      generatePantryCheck(menu.id);
    } catch (err) {
      console.error(`Regeneration for menu ${menu.id} failed:`, err);
    }
  }
}

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
router.post('/', (req: Request, res: Response) => {
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

  const recipeId = result.lastInsertRowid as number;
  if (Array.isArray((recipe_data as { ingredients?: RawIngredient[] }).ingredients)) {
    syncRecipeIngredients(db, recipeId, (recipe_data as { ingredients: RawIngredient[] }).ingredients, (recipe_data as { servings?: number }).servings ?? 4);
  }

  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  res.status(201).json(recipe);
});

// PUT /api/recipes/:id - update a recipe; resyncs ingredients and refreshes
// shopping lists of active menus that use it
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig recept ID' });
    return;
  }

  const existing = db.prepare('SELECT id FROM recipes WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'Recept niet gevonden' });
    return;
  }

  const { recipe_data, tags } = req.body;
  if (!recipe_data || typeof recipe_data !== 'object') {
    res.status(400).json({ error: 'Recept data is verplicht' });
    return;
  }

  db.prepare('UPDATE recipes SET recipe_data = ?, tags = COALESCE(?, tags) WHERE id = ?')
    .run(JSON.stringify(recipe_data), tags ? JSON.stringify(tags) : null, id);

  if (Array.isArray((recipe_data as { ingredients?: RawIngredient[] }).ingredients)) {
    syncRecipeIngredients(db, id, (recipe_data as { ingredients: RawIngredient[] }).ingredients, (recipe_data as { servings?: number }).servings ?? 4);
  }
  regenerateActiveMenusForRecipe(id);

  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  res.json(recipe);
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
router.delete('/:id', (req: Request, res: Response) => {
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
