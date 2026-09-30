import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { recipeImagesDir } from '../db.js';
import { RecipeError } from './recipes.js';

/**
 * Recipe pictures are made off-server (scripts/generate-recipe-images.ts runs
 * Codex on a Mac) and uploaded as ready-to-serve webp. The server only keeps
 * track of which recipes still need one and stores what comes back.
 */

/** A 512px webp is ~50 kB; this leaves room without accepting anything huge. */
export const MAX_IMAGE_BYTES = 600 * 1024;
export const MAX_QUEUE = 100;

export function recipeImagePath(id: number): string {
  return path.join(recipeImagesDir(), `${id}.webp`);
}

/** RIFF container with a WEBP form type: "RIFF" <size> "WEBP". */
export function isWebp(buf: Buffer): boolean {
  return buf.length > 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WEBP';
}

export interface ImageQueueItem {
  id: number;
  name: string;
  meal_type: string | null;
  ingredients: string[];
  /** Start of the method, so the picture shows the dish as it is served. */
  method: string;
  /** Echoed back on upload, so a newer request made meanwhile is not lost. */
  requested_at: string | null;
}

const METHOD_CHARS = 600;

/**
 * Recipes waiting for a picture: explicit requests first (oldest first), then
 * approved recipes, then concepts. Archived recipes only when asked for, and a
 * recipe whose last attempt failed waits until someone asks again.
 */
export function imageQueue(db: Database.Database, limit: number): ImageQueueItem[] {
  const rows = db.prepare(`
    SELECT id, name, meal_type, recipe_data, image_requested_at
    FROM recipes
    WHERE image_error IS NULL
      AND (image_requested_at IS NOT NULL OR (image_version IS NULL AND status != 'archief'))
    ORDER BY image_requested_at IS NULL, image_requested_at,
             CASE status WHEN 'goedgekeurd' THEN 0 ELSE 1 END, id
    LIMIT ?
  `).all(Math.min(Math.max(limit, 1), MAX_QUEUE)) as Array<{
    id: number; name: string; meal_type: string | null; recipe_data: string; image_requested_at: string | null;
  }>;

  return rows.map((row) => {
    let data: { ingredients?: Array<{ name?: unknown }>; steps?: unknown[] } = {};
    try { data = JSON.parse(row.recipe_data); } catch { /* malformed data: name only */ }
    const ingredients = (data.ingredients ?? [])
      .map((i) => (typeof i?.name === 'string' ? i.name : ''))
      .filter(Boolean);
    const method = (data.steps ?? []).filter((s): s is string => typeof s === 'string').join(' ');
    return {
      id: row.id,
      name: row.name,
      meal_type: row.meal_type,
      ingredients,
      method: method.length > METHOD_CHARS ? `${method.slice(0, METHOD_CHARS)}…` : method,
      requested_at: row.image_requested_at,
    };
  });
}

function assertRecipe(db: Database.Database, id: number): void {
  if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) {
    throw new RecipeError('Recept niet gevonden', 404);
  }
}

/**
 * Store an uploaded picture and bump its version. The request is only settled
 * when it is still the one the worker saw; one made while it was generating
 * stays queued.
 */
export function saveRecipeImage(db: Database.Database, id: number, image: Buffer, seenRequest: string | null): number {
  assertRecipe(db, id);
  if (!isWebp(image)) throw new RecipeError('Plaatje moet een webp zijn', 415);
  if (image.length > MAX_IMAGE_BYTES) throw new RecipeError('Plaatje is te groot', 413);

  const target = recipeImagePath(id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Write aside and rename, so a reader never gets half a file
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, image);
  fs.renameSync(temp, target);

  db.prepare(`
    UPDATE recipes
    SET image_version = COALESCE(image_version, 0) + 1,
        image_error = NULL,
        image_requested_at = CASE WHEN image_requested_at IS ? THEN NULL ELSE image_requested_at END
    WHERE id = ?
  `).run(seenRequest, id);
  return (db.prepare('SELECT image_version FROM recipes WHERE id = ?').get(id) as { image_version: number }).image_version;
}

/** Park a recipe the worker could not make a picture for, unless it was asked again meanwhile. */
export function recordImageError(db: Database.Database, id: number, message: string, seenRequest: string | null): void {
  assertRecipe(db, id);
  const text = message.trim().slice(0, 300) || 'Onbekende fout';
  db.prepare('UPDATE recipes SET image_error = ? WHERE id = ? AND image_requested_at IS ?')
    .run(text, id, seenRequest);
}

/** Ask for a (new) picture; also the way to retry after an error. */
export function requestRecipeImage(db: Database.Database, id: number): void {
  const result = db.prepare(`
    UPDATE recipes SET image_requested_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), image_error = NULL
    WHERE id = ?
  `).run(id);
  if (result.changes === 0) throw new RecipeError('Recept niet gevonden', 404);
}

/** Remove the file of a deleted recipe; a missing file is fine. */
export function removeRecipeImage(id: number): void {
  fs.rmSync(recipeImagePath(id), { force: true });
}
