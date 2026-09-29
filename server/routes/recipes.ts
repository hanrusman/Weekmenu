import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { regenerateActiveMenus } from '../services/shopping-generator.js';
import {
  RecipeError,
  RECIPE_STATUSES,
  countRecipesByStatus,
  getRecipe,
  listRecipes,
  parseRecipeInput,
  previewIngredients,
  saveRecipe,
  setRecipeStatus,
} from '../services/recipes.js';
import { MAX_RECIPE_TEXT, isParserConfigured, parseRecipeText } from '../services/recipe-parser.js';

const router = Router();

function parseId(raw: unknown, res: Response): number | null {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Ongeldig recept ID' });
    return null;
  }
  return id;
}

/** Map domain errors to HTTP; anything else is a real bug and goes to Express. */
function handleError(res: Response, err: unknown): void {
  if (err instanceof RecipeError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

// GET /api/recipes?status=&search= - list recipes with feedback ratings
router.get('/', (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined;
  if (status && !RECIPE_STATUSES.includes(status as typeof RECIPE_STATUSES[number])) {
    res.status(400).json({ error: 'Ongeldige status' });
    return;
  }
  const db = getDb();
  res.json({ recipes: listRecipes(db, { status, search }), counts: countRecipesByStatus(db) });
});

// GET /api/recipes/parser - whether free-text import is available
router.get('/parser', (_req: Request, res: Response) => {
  res.json({ configured: isParserConfigured() });
});

// POST /api/recipes/parse - free recipe text -> structured draft (not saved)
router.post('/parse', async (req: Request, res: Response) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Plak eerst een recept' });
    return;
  }
  if (text.length > MAX_RECIPE_TEXT) {
    res.status(400).json({ error: `Recept is te lang (max ${MAX_RECIPE_TEXT} tekens)` });
    return;
  }
  try {
    const draft = await parseRecipeText(text);
    res.json({ draft, preview: previewIngredients(getDb(), draft.ingredients) });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/recipes/preview-ingredients - how ingredient lines will land in the library
router.post('/preview-ingredients', (req: Request, res: Response) => {
  try {
    res.json(previewIngredients(getDb(), req.body?.ingredients));
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/recipes - add a recipe (from import review or by hand)
router.post('/', (req: Request, res: Response) => {
  try {
    const db = getDb();
    const id = saveRecipe(db, parseRecipeInput(req.body));
    res.status(201).json(getRecipe(db, id));
  } catch (err) {
    handleError(res, err);
  }
});

// PUT /api/recipes/:id - update a recipe; resyncs ingredients and refreshes
// shopping lists of active menus that use it
router.put('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const db = getDb();
    saveRecipe(db, parseRecipeInput(req.body), id);
    regenerateActiveMenus([id]);
    res.json(getRecipe(db, id));
  } catch (err) {
    handleError(res, err);
  }
});

// PATCH /api/recipes/:id/status - approve, archive or back to concept
router.patch('/:id/status', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const db = getDb();
    setRecipeStatus(db, id, req.body?.status);
    res.json(getRecipe(db, id));
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/recipes/:id
router.get('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    res.json(getRecipe(getDb(), id));
  } catch (err) {
    handleError(res, err);
  }
});

// DELETE /api/recipes/:id
router.delete('/:id', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const result = getDb().prepare('DELETE FROM recipes WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'Recept niet gevonden' });
    return;
  }
  res.json({ ok: true });
});

export default router;
