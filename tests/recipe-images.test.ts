// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// A database of its own, so the pictures land in a throwaway directory next to it
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-images-test-'));
process.env.DATABASE_PATH = path.join(DIR, 'weekmenu.db');
process.env.NODE_ENV = 'test';
process.env.IMAGE_WORKER_TOKEN = 'worker-secret';

const { getDb, closeDb } = await import('../server/db');
const images = await import('../server/services/recipe-images');
const { createSession, hashPassword } = await import('../server/services/auth');
const { default: app } = await import('../server/index');

/** Smallest valid-looking webp: the RIFF/WEBP header is all the server checks. */
function webp(size = 64): Buffer {
  const buf = Buffer.alloc(size);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(size - 8, 4);
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

function addRecipe(name: string, fields: Record<string, unknown> = {}): number {
  const data = JSON.stringify({
    servings: 4,
    ingredients: [{ name: 'prei', amount: 1, unit: 'stuks' }, { name: 'kabeljauwfilet', amount: 4, unit: 'stuks' }],
    steps: ['Verwarm de oven voor.', 'Leg de vis op de groente.'],
  });
  const id = getDb().prepare("INSERT INTO recipes (name, recipe_data, status) VALUES (?, ?, 'concept')")
    .run(name, data).lastInsertRowid as number;
  for (const [key, value] of Object.entries(fields)) {
    getDb().prepare(`UPDATE recipes SET ${key} = ? WHERE id = ?`).run(value, id);
  }
  return id;
}

function row(id: number) {
  return getDb().prepare('SELECT image_version, image_requested_at, image_error FROM recipes WHERE id = ?').get(id) as {
    image_version: number | null; image_requested_at: string | null; image_error: string | null;
  };
}

beforeEach(() => {
  getDb().exec('DELETE FROM menu_days; DELETE FROM menus; DELETE FROM recipes;');
  fs.rmSync(path.join(DIR, 'images'), { recursive: true, force: true });
});

afterAll(() => {
  closeDb();
  fs.rmSync(DIR, { recursive: true, force: true });
});

describe('image queue', () => {
  it('lists explicit requests first, then approved recipes, then concepts', () => {
    const concept = addRecipe('Stamppot');
    const approved = addRecipe('Linzensoep', { status: 'goedgekeurd' });
    const requested = addRecipe('Kabeljauw', { image_version: 1, image_requested_at: '2026-09-30T10:00:00.000Z' });

    expect(images.imageQueue(getDb(), 10).map((r) => r.id)).toEqual([requested, approved, concept]);
  });

  it('leaves out recipes that have a picture, failed ones, and archived ones nobody asked for', () => {
    addRecipe('Heeft er een', { image_version: 2 });
    addRecipe('Mislukt', { image_error: 'Codex leverde geen plaatje' });
    addRecipe('Oud recept', { status: 'archief' });
    const archivedButAsked = addRecipe('Oud maar gevraagd', { status: 'archief', image_requested_at: '2026-09-30T10:00:00.000Z' });

    expect(images.imageQueue(getDb(), 10).map((r) => r.id)).toEqual([archivedButAsked]);
  });

  it('gives what the picture needs: ingredient names and the start of the method', () => {
    const id = addRecipe('Kabeljauw uit de oven');
    const [item] = images.imageQueue(getDb(), 10);
    expect(item).toEqual({
      id, name: 'Kabeljauw uit de oven', meal_type: null,
      ingredients: ['prei', 'kabeljauwfilet'],
      method: 'Verwarm de oven voor. Leg de vis op de groente.',
      requested_at: null,
    });
  });

  it('copes with unreadable recipe data', () => {
    const id = getDb().prepare("INSERT INTO recipes (name, recipe_data) VALUES ('Kapot', 'geen json')").run().lastInsertRowid;
    expect(images.imageQueue(getDb(), 10)).toEqual([
      { id, name: 'Kapot', meal_type: null, ingredients: [], method: '', requested_at: null },
    ]);
  });

  it('respects the limit', () => {
    addRecipe('Een'); addRecipe('Twee'); addRecipe('Drie');
    expect(images.imageQueue(getDb(), 2)).toHaveLength(2);
  });
});

describe('storing a picture', () => {
  it('writes the file, bumps the version and clears an earlier error', () => {
    const id = addRecipe('Kabeljauw', { image_version: 1, image_error: 'oud' });
    expect(images.saveRecipeImage(getDb(), id, webp(), null)).toBe(2);
    expect(fs.readFileSync(images.recipeImagePath(id))).toEqual(webp());
    expect(row(id)).toMatchObject({ image_version: 2, image_error: null });
  });

  it('refuses something that is not a webp', () => {
    const id = addRecipe('Kabeljauw');
    expect(() => images.saveRecipeImage(getDb(), id, Buffer.from('\x89PNG\r\n\x1a\n0000'), null))
      .toThrow(expect.objectContaining({ status: 415 }));
    expect(row(id).image_version).toBeNull();
  });

  it('refuses a picture that is too large', () => {
    const id = addRecipe('Kabeljauw');
    expect(() => images.saveRecipeImage(getDb(), id, webp(images.MAX_IMAGE_BYTES + 1), null))
      .toThrow(expect.objectContaining({ status: 413 }));
  });

  it('reports an unknown recipe', () => {
    expect(() => images.saveRecipeImage(getDb(), 999, webp(), null)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('settles the request the worker saw', () => {
    const id = addRecipe('Kabeljauw', { image_version: 1, image_requested_at: '2026-09-30T10:00:00.000Z' });
    images.saveRecipeImage(getDb(), id, webp(), '2026-09-30T10:00:00.000Z');
    expect(row(id).image_requested_at).toBeNull();
  });

  it('keeps a request made while the worker was busy, so it is picked up next time', () => {
    const id = addRecipe('Kabeljauw', { image_version: 1, image_requested_at: '2026-09-30T10:00:00.000Z' });
    const [seen] = images.imageQueue(getDb(), 1);
    images.requestRecipeImage(getDb(), id); // asked again meanwhile
    images.saveRecipeImage(getDb(), id, webp(), seen.requested_at);
    expect(row(id).image_requested_at).not.toBeNull();
    expect(images.imageQueue(getDb(), 10).map((r) => r.id)).toEqual([id]);
  });
});

describe('failed pictures and new requests', () => {
  it('parks a recipe the worker could not make a picture for', () => {
    const id = addRecipe('Kabeljauw');
    images.recordImageError(getDb(), id, 'Geen transparante achtergrond', null);
    expect(row(id).image_error).toBe('Geen transparante achtergrond');
    expect(images.imageQueue(getDb(), 10)).toEqual([]);
  });

  it('does not park a recipe that was asked for again meanwhile', () => {
    const id = addRecipe('Kabeljauw');
    images.requestRecipeImage(getDb(), id);
    images.recordImageError(getDb(), id, 'Codex leverde geen plaatje', null);
    expect(row(id).image_error).toBeNull();
  });

  it('asking again clears the error and queues it first', () => {
    addRecipe('Ander recept');
    const id = addRecipe('Kabeljauw', { image_version: 1, image_error: 'mislukt' });
    images.requestRecipeImage(getDb(), id);
    expect(row(id)).toMatchObject({ image_error: null, image_requested_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(images.imageQueue(getDb(), 10)[0].id).toBe(id);
  });

  it('asking for an unknown recipe is a 404', () => {
    expect(() => images.requestRecipeImage(getDb(), 999)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('over HTTP', () => {
  let server: Server;
  let base: string;
  let cookie: string;

  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const db = getDb();
    db.exec('DELETE FROM sessions; DELETE FROM users;');
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)').run('test@example.com', hashPassword('x'));
    cookie = `weekmenu_session=${createSession(1).token}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const worker = (route: string, init: RequestInit = {}, token = 'worker-secret') =>
    fetch(`${base}/api/image-worker${route}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string>) },
    });

  it('lets only the worker token at the queue', async () => {
    addRecipe('Kabeljauw');
    expect((await worker('/queue', {}, 'wrong-secret')).status).toBe(401);
    expect((await fetch(`${base}/api/image-worker/queue`, { headers: { Cookie: cookie } })).status).toBe(401);
    const res = await worker('/queue?limit=5');
    expect(res.status).toBe(200);
    expect((await res.json()).recipes).toHaveLength(1);
  });

  it('rejects a queue limit out of range', async () => {
    expect((await worker('/queue?limit=0')).status).toBe(400);
    expect((await worker('/queue?limit=abc')).status).toBe(400);
  });

  it('stores an upload and serves it to a signed-in user only, cacheable by version', async () => {
    const id = addRecipe('Kabeljauw');
    const put = await worker(`/recipes/${id}/image`, {
      method: 'PUT', headers: { 'Content-Type': 'image/webp', 'X-Image-Request': '' }, body: new Uint8Array(webp()),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ image_version: 1 });

    expect((await fetch(`${base}/api/recipes/${id}/image?v=1`)).status).toBe(401);
    const res = await fetch(`${base}/api/recipes/${id}/image?v=1`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(webp());
  });

  it('answers 404 for a recipe without a picture', async () => {
    const id = addRecipe('Kabeljauw');
    expect((await fetch(`${base}/api/recipes/${id}/image?v=1`, { headers: { Cookie: cookie } })).status).toBe(404);
  });

  it('refuses a wrong type and an oversized upload with a readable error', async () => {
    const id = addRecipe('Kabeljauw');
    const png = await worker(`/recipes/${id}/image`, {
      method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array(8),
    });
    expect(png.status).toBe(415);

    const big = await worker(`/recipes/${id}/image`, {
      method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: new Uint8Array(webp(images.MAX_IMAGE_BYTES + 10)),
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'Plaatje is te groot' });
  });

  it('records a reported failure', async () => {
    const id = addRecipe('Kabeljauw');
    const res = await worker(`/recipes/${id}/image-error`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Codex leverde geen plaatje', requested_at: null }),
    });
    expect(res.status).toBe(200);
    expect(row(id).image_error).toBe('Codex leverde geen plaatje');
  });

  it('queues a new picture from the app and returns the updated recipe', async () => {
    const id = addRecipe('Kabeljauw', { image_version: 3 });
    const res = await fetch(`${base}/api/recipes/${id}/image-request`, { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).image_requested_at).toMatch(/^\d{4}-/);
  });

  it('removes the picture along with the recipe', async () => {
    const id = addRecipe('Kabeljauw');
    images.saveRecipeImage(getDb(), id, webp(), null);
    const res = await fetch(`${base}/api/recipes/${id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(fs.existsSync(images.recipeImagePath(id))).toBe(false);
  });

  it('gives menu days the version of their recipe\'s picture', async () => {
    const id = addRecipe('Kabeljauw', { image_version: 4 });
    const menuId = getDb().prepare("INSERT INTO menus (week_number, year, status) VALUES (40, 2026, 'active')").run().lastInsertRowid;
    const dayId = getDb().prepare(`
      INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, recipe_id)
      VALUES (?, 0, 'Maandag', 'Kabeljauw', '{}', ?)
    `).run(menuId, id).lastInsertRowid;

    const day = await (await fetch(`${base}/api/days/${dayId}`, { headers: { Cookie: cookie } })).json();
    expect(day.recipe_image_version).toBe(4);
    const menu = await (await fetch(`${base}/api/menus/${menuId}`, { headers: { Cookie: cookie } })).json();
    expect(menu.days[0].recipe_image_version).toBe(4);
    const active = await (await fetch(`${base}/api/menus/active`, { headers: { Cookie: cookie } })).json();
    expect(active.days[0].recipe_image_version).toBe(4);
  });
});
