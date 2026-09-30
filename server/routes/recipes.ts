import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
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
  updateRecipe,
} from '../services/recipes.js';
import {
  BULK_JSON_INSTRUCTIONS, MAX_RECIPE_TEXT, importRecipeText, isParserConfigured, parseRecipeText,
} from '../services/recipe-parser.js';
import { splitRecipes } from '../services/recipe-split.js';
import { recipeImagePath, removeRecipeImage, requestRecipeImage } from '../services/recipe-images.js';

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

// POST /api/recipes/split - a markdown cookbook -> candidate recipes, marked when
// a recipe of that name is already in the library
router.post('/split', (req: Request, res: Response) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Geen tekst ontvangen' });
    return;
  }
  const existing = getDb().prepare('SELECT id, name FROM recipes WHERE name = ? COLLATE NOCASE');
  const candidates = splitRecipes(text).map((c) => {
    const match = existing.get(c.title) as { id: number; name: string } | undefined;
    return { ...c, existing: match ?? null };
  });
  res.json({ candidates });
});

// POST /api/recipes/import-text - read one recipe with the model and store it as concept
router.post('/import-text', async (req: Request, res: Response) => {
  const { text, title, source } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_RECIPE_TEXT) {
    res.status(400).json({ error: `Recepttekst ontbreekt of is te lang (max ${MAX_RECIPE_TEXT} tekens)` });
    return;
  }
  try {
    const recipe = await importRecipeText(getDb(), text, {
      title: typeof title === 'string' ? title : undefined,
      source: typeof source === 'string' ? source : undefined,
    });
    res.status(201).json(recipe);
  } catch (err) {
    handleError(res, err);
  }
});

// GET /api/recipes/bulk-format - instructions for delivering recipes as a JSON array
router.get('/bulk-format', (_req: Request, res: Response) => {
  res.json({ text: BULK_JSON_INSTRUCTIONS });
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
    updateRecipe(db, parseRecipeInput(req.body), id);
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

// GET /api/recipes/:id/image?v= - the recipe's own picture; the version in
// the URL changes with every new picture, so it can be cached for good
router.get('/:id/image', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  const row = getDb().prepare('SELECT image_version FROM recipes WHERE id = ?').get(id) as { image_version: number | null } | undefined;
  if (!row?.image_version) {
    res.status(404).json({ error: 'Geen plaatje' });
    return;
  }
  res.sendFile(recipeImagePath(id), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' },
  }, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Geen plaatje' });
  });
});

// POST /api/recipes/:id/image-request - queue a (new) picture, also to retry after an error
router.post('/:id/image-request', (req: Request, res: Response) => {
  const id = parseId(req.params.id, res);
  if (id === null) return;
  try {
    const db = getDb();
    requestRecipeImage(db, id);
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
  removeRecipeImage(id);
  res.json({ ok: true });
});

export default router;
