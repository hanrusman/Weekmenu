import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { syncRecipeIngredients, RawIngredient } from '../services/ingredients.js';
import { generateShoppingList, generatePantryCheck } from '../services/shopping-generator.js';
import { RecipeSchema } from '../services/menu-generator.js';
import { importRecipeFromUrl } from '../services/recipe-import.js';
import { updateRecipe, RecipeError } from '../services/recipes.js';

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

// GET /api/recipes - list recipes with aggregated day feedback
router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { search, tag, favorite } = req.query;

  let query = `
    SELECT r.*,
      COALESCE(SUM(CASE WHEN df.rating = 'lekker' THEN 1 ELSE 0 END), 0) AS feedback_lekker,
      COALESCE(SUM(CASE WHEN df.rating = 'ok' THEN 1 ELSE 0 END), 0) AS feedback_ok,
      COALESCE(SUM(CASE WHEN df.rating = 'minder' THEN 1 ELSE 0 END), 0) AS feedback_minder
    FROM recipes r
    LEFT JOIN menu_days md ON md.recipe_id = r.id
    LEFT JOIN day_feedback df ON df.day_id = md.id
  `;
  const params: string[] = [];

  if (search && typeof search === 'string') {
    query += ' WHERE r.name LIKE ?';
    params.push(`%${search}%`);
  } else if (tag && typeof tag === 'string') {
    query += ' WHERE r.tags LIKE ?';
    params.push(`%${tag}%`);
  } else if (favorite === '1') {
    query += ' WHERE r.favorite = 1';
  }

  query += ' GROUP BY r.id ORDER BY r.times_used DESC, r.name';
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
  const parsed = RecipeSchema.safeParse(recipe_data);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ongeldig recept format', details: parsed.error.issues });
    return;
  }

  const existing = db.prepare('SELECT id FROM recipes WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) {
    res.status(409).json({ error: 'Er bestaat al een recept met deze naam' });
    return;
  }

  const { prep_time_minutes, cost_index } = req.body;
  const result = db.prepare(
    'INSERT INTO recipes (name, source, recipe_data, tags, prep_time_minutes, cost_index) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    name,
    source || 'manual',
    JSON.stringify(recipe_data),
    JSON.stringify(tags || []),
    typeof prep_time_minutes === 'number' ? prep_time_minutes : null,
    typeof cost_index === 'string' ? cost_index : null,
  );

  const recipeId = result.lastInsertRowid as number;
  if (Array.isArray((recipe_data as { ingredients?: RawIngredient[] }).ingredients)) {
    syncRecipeIngredients(db, recipeId, (recipe_data as { ingredients: RawIngredient[] }).ingredients, (recipe_data as { servings?: number }).servings ?? 4);
  }

  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(recipeId);
  res.status(201).json(recipe);
});

// PUT /api/recipes/:id - update a recipe (rename allowed); resyncs
// ingredients and refreshes shopping lists of active menus that use it
router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig recept ID' });
    return;
  }

  const { recipe_data, tags, name, prep_time_minutes, cost_index } = req.body;
  if (!recipe_data || typeof recipe_data !== 'object') {
    res.status(400).json({ error: 'Recept data is verplicht' });
    return;
  }
  const parsed = RecipeSchema.safeParse(recipe_data);
  if (!parsed.success) {
    res.status(400).json({ error: 'Ongeldig recept format', details: parsed.error.issues });
    return;
  }

  try {
    updateRecipe(id, { recipe_data, tags, name, prep_time_minutes, cost_index });
  } catch (err) {
    if (err instanceof RecipeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
  regenerateActiveMenusForRecipe(id);

  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  res.json(recipe);
});

// POST /api/recipes/:id/favorite - set or clear the favorite flag
router.post('/:id/favorite', (req: Request, res: Response) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig recept ID' });
    return;
  }
  const { favorite } = req.body;
  if (typeof favorite !== 'boolean') {
    res.status(400).json({ error: 'Favoriet moet true of false zijn' });
    return;
  }
  const result = db.prepare('UPDATE recipes SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Recept niet gevonden' });
    return;
  }
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  res.json(recipe);
});

// POST /api/recipes/import-url - fetch a recipe page and return a draft
// (never saved directly; the client prefills the recipe form for review)
router.post('/import-url', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'URL is verplicht' });
    return;
  }
  try {
    const draft = await importRecipeFromUrl(url);
    res.json(draft);
  } catch (err) {
    res.status(422).json({ error: err instanceof Error ? err.message : 'Import mislukt' });
  }
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
