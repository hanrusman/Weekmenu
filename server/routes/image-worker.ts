import express, { Router, Request, Response, NextFunction } from 'express';
import { getDb } from '../db.js';
import { RecipeError } from '../services/recipes.js';
import {
  MAX_IMAGE_BYTES, MAX_QUEUE, SeenState, imageQueue, recordImageError, saveRecipeImage,
} from '../services/recipe-images.js';

/**
 * For the script that makes recipe pictures (bearer token, no session):
 * fetch what needs a picture, upload the result or report a failure.
 */
const router = Router();

function recipeId(raw: unknown): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new RecipeError('Ongeldig recept ID');
  return id;
}

/**
 * The picture state the worker saw in the queue, echoed back with its result.
 * Empty (or null) means there was none; a version must be a positive integer.
 */
function seenState(version: unknown, requestedAt: unknown): SeenState {
  let image_version: number | null = null;
  if (version !== undefined && version !== null && version !== '') {
    image_version = Number(version);
    if (!Number.isInteger(image_version) || image_version <= 0) throw new RecipeError('Ongeldige image_version');
  }
  return { image_version, requested_at: typeof requestedAt === 'string' && requestedAt ? requestedAt : null };
}

// GET /api/image-worker/queue?limit=
router.get('/queue', (req: Request, res: Response) => {
  const limit = Number(req.query.limit ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUEUE) {
    res.status(400).json({ error: `limit moet tussen 1 en ${MAX_QUEUE} liggen` });
    return;
  }
  res.json({ recipes: imageQueue(getDb(), limit) });
});

// PUT /api/image-worker/recipes/:id/image - body: the webp; headers X-Image-Version and
// X-Image-Request: image_version and requested_at as the queue gave them (empty for null)
router.put('/recipes/:id/image',
  // One byte over the limit, so an oversized upload reaches the service's own message
  express.raw({ type: 'image/webp', limit: MAX_IMAGE_BYTES + 1 }),
  (req: Request, res: Response) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(415).json({ error: 'Stuur het plaatje als image/webp' });
      return;
    }
    const seen = seenState(req.get('X-Image-Version'), req.get('X-Image-Request'));
    const version = saveRecipeImage(getDb(), recipeId(req.params.id), req.body, seen);
    res.json({ image_version: version });
  });

// POST /api/image-worker/recipes/:id/image-error - { message, image_version, requested_at }
router.post('/recipes/:id/image-error', (req: Request, res: Response) => {
  const message = typeof req.body?.message === 'string' ? req.body.message : '';
  const seen = seenState(req.body?.image_version, req.body?.requested_at);
  recordImageError(getDb(), recipeId(req.params.id), message, seen);
  res.json({ ok: true });
});

// Domain errors and body-parser refusals (413 too large) as JSON for the script
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof RecipeError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const status = (err as { status?: number }).status;
  if (status === 413) {
    res.status(413).json({ error: 'Plaatje is te groot' });
    return;
  }
  next(err);
});

export default router;
