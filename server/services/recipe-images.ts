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

/**
 * Every version is a file of its own, so the bytes behind /image?v=N (cached
 * for good) never change, not even while a newer version is being stored.
 */
export function recipeImagePath(id: number, version: number): string {
  return path.join(recipeImagesDir(), `${id}-v${version}.webp`);
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
  /** With image_version, what the worker saw: echoed back so a stale job is refused. */
  requested_at: string | null;
  image_version: number | null;
}

/** The recipe's picture state as a worker saw it in the queue. */
export interface SeenState {
  image_version: number | null;
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
    SELECT id, name, meal_type, recipe_data, image_requested_at, image_version
    FROM recipes
    WHERE image_error IS NULL
      AND (image_requested_at IS NOT NULL OR (image_version IS NULL AND status != 'archief'))
    ORDER BY image_requested_at IS NULL, image_requested_at,
             CASE status WHEN 'goedgekeurd' THEN 0 ELSE 1 END, id
    LIMIT ?
  `).all(Math.min(Math.max(limit, 1), MAX_QUEUE)) as Array<{
    id: number; name: string; meal_type: string | null; recipe_data: string;
    image_requested_at: string | null; image_version: number | null;
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
      image_version: row.image_version,
    };
  });
}

const STALE = 'Verouderde opdracht: het plaatje van dit recept is intussen veranderd of opnieuw aangevraagd';

function currentState(db: Database.Database, id: number): SeenState {
  const row = db.prepare('SELECT image_version, image_requested_at FROM recipes WHERE id = ?').get(id) as {
    image_version: number | null; image_requested_at: string | null;
  } | undefined;
  if (!row) throw new RecipeError('Recept niet gevonden', 404);
  return { image_version: row.image_version, requested_at: row.image_requested_at };
}

function isCurrent(db: Database.Database, id: number, seen: SeenState): boolean {
  const now = currentState(db, id);
  return now.image_version === seen.image_version && now.requested_at === seen.requested_at;
}

/**
 * Store an uploaded picture as the next version. Only for the job the worker
 * fetched: when the picture or the request changed since (another worker was
 * first, or someone asked for a new one), the upload is refused as stale
 * (409) and nothing is written.
 */
export function saveRecipeImage(db: Database.Database, id: number, image: Buffer, seen: SeenState): number {
  if (!isCurrent(db, id, seen)) throw new RecipeError(STALE, 409);
  if (!isWebp(image)) throw new RecipeError('Plaatje moet een webp zijn', 415);
  if (image.length > MAX_IMAGE_BYTES) throw new RecipeError('Plaatje is te groot', 413);

  const next = (seen.image_version ?? 0) + 1;
  const target = recipeImagePath(id, next);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // Write aside and rename, so a reader never gets half a file
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, image);
  fs.renameSync(temp, target);

  const result = db.prepare(`
    UPDATE recipes SET image_version = ?, image_requested_at = NULL, image_error = NULL
    WHERE id = ? AND image_version IS ? AND image_requested_at IS ?
  `).run(next, id, seen.image_version, seen.requested_at);
  if (result.changes === 0) {
    // Only possible with another process writing in between
    fs.rmSync(target, { force: true });
    throw new RecipeError(STALE, 409);
  }
  if (seen.image_version) fs.rmSync(recipeImagePath(id, seen.image_version), { force: true });
  return next;
}

/** Park a recipe whose picture came out unusable; refused as stale like an upload. */
export function recordImageError(db: Database.Database, id: number, message: string, seen: SeenState): void {
  if (!isCurrent(db, id, seen)) throw new RecipeError(STALE, 409);
  const text = message.trim().slice(0, 300) || 'Onbekende fout';
  db.prepare('UPDATE recipes SET image_error = ? WHERE id = ? AND image_version IS ? AND image_requested_at IS ?')
    .run(text, id, seen.image_version, seen.requested_at);
}

/** Ask for a (new) picture; also the way to retry after an error. */
export function requestRecipeImage(db: Database.Database, id: number): void {
  const result = db.prepare(`
    UPDATE recipes SET image_requested_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), image_error = NULL
    WHERE id = ?
  `).run(id);
  if (result.changes === 0) throw new RecipeError('Recept niet gevonden', 404);
}

/** Remove the files of a deleted recipe; none at all is fine. */
export function removeRecipeImages(id: number): void {
  const dir = recipeImagesDir();
  if (!fs.existsSync(dir)) return;
  const mine = new RegExp(`^${id}-v\\d+\\.webp$`);
  for (const file of fs.readdirSync(dir)) {
    if (mine.test(file)) fs.rmSync(path.join(dir, file), { force: true });
  }
}
