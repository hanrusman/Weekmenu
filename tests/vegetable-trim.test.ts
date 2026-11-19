// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-trim-'));
process.env.DATABASE_PATH = path.join(DIR, 'weekmenu.db');
process.env.NODE_ENV = 'test';

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, parseRecipeInput, getRecipe, recipeInputOf } = await import('../server/services/recipes');
const { revertVegetables } = await import('../server/services/vegetable-boost');
const { planTrimOf, revertTrim, trimAllVegetables, trimVegetables } = await import('../server/services/vegetable-trim');
const { importMenu } = await import('../server/services/menu-generator');
const { createSession, hashPassword } = await import('../server/services/auth');
const { default: app } = await import('../server/index');

type Ingredient = { name: string; amount: number | string | null; unit: string; product_group: string; note?: string | null };

const veg = (name: string, amount: number | string, unit = 'g', note?: string): Ingredient =>
  ({ name, amount, unit, product_group: 'groenten', ...(note ? { note } : {}) });
const spaghetti: Ingredient = { name: 'volkoren spaghetti', amount: 400, unit: 'g', product_group: 'droogwaren' };
const prawns: Ingredient = { name: 'garnalen', amount: 400, unit: 'g', product_group: 'vis' };

function recipe(name: string, ingredients: Ingredient[], extra: Record<string, unknown> = {}) {
  return saveRecipe(getDb(), parseRecipeInput({
    name, servings: 4, status: 'goedgekeurd', meal_type: 'pasta', source: 'Kookboek.md',
    ingredients: [spaghetti, prawns, ...ingredients], steps: ['Kook de pasta.'], ...extra,
  }));
}

/** A cookbook recipe as a top-up left it: `now` saved, `was` kept as the revision to go back to. */
function toppedUp(name: string, was: Ingredient[], now: Ingredient[], steps = ['Kook de pasta.']) {
  const id = recipe(name, was);
  const original = recipeInputOf(getRecipe(getDb(), id));
  saveRecipe(getDb(), parseRecipeInput({ ...original, ingredients: [spaghetti, prawns, ...now], steps }), id);
  getDb().prepare("INSERT INTO recipe_revisions (recipe_id, reason, input, veg_before, veg_after, summary) VALUES (?, 'groente', ?, 100, 500, 'Meer groente.')")
    .run(id, JSON.stringify(original));
  return id;
}

const data = (id: number) => JSON.parse(getRecipe(getDb(), id).recipe_data as string) as { ingredients: Ingredient[]; steps: string[] };
const amounts = (id: number) => Object.fromEntries(data(id).ingredients.map((i) => [i.name, i.amount]));
const perAdult = (id: number) => getRecipe(getDb(), id).veg_per_serving;
const revisions = (id: number) => (getDb().prepare('SELECT reason FROM recipe_revisions WHERE recipe_id = ? ORDER BY id').all(id) as Array<{ reason: string }>).map((r) => r.reason);

let server: Server;
let base: string;
let cookie: string;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  getDb().exec('DELETE FROM sessions; DELETE FROM users;');
  getDb().prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)').run('test@example.com', hashPassword('x'));
  cookie = `weekmenu_session=${createSession(1).token}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  fs.rmSync(DIR, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec('DELETE FROM menus; DELETE FROM recipe_revisions; DELETE FROM recipe_ingredients; DELETE FROM recipes; DELETE FROM ingredients;');
});

// Four servings are two adults and two children, who eat half: 750 g of vegetables is the aim of 250 g per adult

describe('a cookbook recipe after its top-up', () => {
  // 300 g of its own, topped up to 1500 g: 500 g per adult
  const was = [veg('courgette', 300)];
  const now = [veg('courgette', 600, 'g', 'verhoogd van 300 g'), veg('spinazie', 600, 'g', 'toegevoegd'), veg('cherrytomaat', 300, 'g', 'gehalveerd')];

  it('gives back what the top-up added, down to the aim, and nothing of its own', () => {
    const id = toppedUp('Pasta garnalen', was, now, ['Kook de pasta.', 'Bak 600 g courgette en voeg 600 g spinazie toe.', 'Roer 2 el olie erdoor.']);
    expect(perAdult(id)).toBe(500);

    const plan = trimVegetables(getDb(), id);
    expect(plan).toMatchObject({ outcome: 'trimmed', before: 500, summary: 'Minder courgette, spinazie en cherrytomaat.' });
    // Every line gives up the same part of what was added; rounded up, so the aim is still met
    expect(amounts(id)).toMatchObject({ courgette: 420, spinazie: 230, cherrytomaat: 120, 'volkoren spaghetti': 400, garnalen: 400 });
    expect(perAdult(id)).toBe(257);
    expect(plan.after).toBe(257);
    // What the recipe had before its top-up stays: 300 g of courgette at least
    expect(Number(amounts(id).courgette)).toBeGreaterThanOrEqual(300);
  });

  it('lets the steps name the new amounts, and drops what the top-up noted on a line', () => {
    const id = toppedUp('Pasta garnalen', was, now, ['Kook de pasta.', 'Bak 600 g courgette en voeg 600 g spinazie toe.', 'Roer 2 el olie erdoor.']);
    trimVegetables(getDb(), id);
    expect(data(id).steps).toEqual(['Kook de pasta.', 'Bak 420 g courgette en voeg 230 g spinazie toe.', 'Roer 2 el olie erdoor.']);
    const notes = Object.fromEntries(data(id).ingredients.map((i) => [i.name, i.note ?? null]));
    expect(notes).toMatchObject({ courgette: null, spinazie: null, cherrytomaat: 'gehalveerd' });
  });

  it('keeps part of every vegetable that was added, so the side dish in the steps is still made', () => {
    // 1200 g of its own is more than the aim already: the salad next to it shrinks to a quarter, no further
    const id = toppedUp('Ovenschotel', [veg('courgette', 600), veg('paprika', 4, 'stuks')],
      [veg('courgette', 600), veg('paprika', 4, 'stuks'), veg('komkommer', 1, 'stuks'), veg('cherrytomaat', 400)]);
    expect(perAdult(id)).toBe(667);

    expect(trimVegetables(getDb(), id).outcome).toBe('trimmed');
    expect(amounts(id)).toMatchObject({ courgette: 600, paprika: 4, komkommer: 0.5, cherrytomaat: 100 });
  });

  it('knows a vegetable the top-up renamed for the one the recipe had', () => {
    const id = toppedUp('Pasta paprika', [veg('rode paprika', 3, 'stuks')], [veg('paprika', 6, 'stuks'), veg('spinazie', 600)]);
    trimVegetables(getDb(), id);
    // Three of the six were there before
    expect(Number(amounts(id).paprika)).toBeGreaterThanOrEqual(3);
  });

  it('leaves a recipe that is rich in vegetables of its own', () => {
    // Topped up for protein only: nothing was added to take back
    const id = toppedUp('Groentecurry', [veg('bloemkool', 1200)], [veg('bloemkool', 1200)]);
    expect(trimVegetables(getDb(), id)).toMatchObject({ outcome: 'own', before: 400, after: 400 });
    expect(amounts(id).bloemkool).toBe(1200);
    expect(revisions(id)).toEqual(['groente']);
  });
});

describe('a recipe written for the old aim', () => {
  const written = (name: string, ingredients: Ingredient[], extra: Record<string, unknown> = {}) =>
    recipe(name, ingredients, { source: 'weekmenu', ...extra });

  it('is brought back evenly, to the aim', () => {
    // 1400 g: the old 350 g a serving
    const id = written('Zalm met sperziebonen', [veg('sperziebonen', 800), veg('courgette', 400), veg('cherrytomaat', 200)]);
    expect(perAdult(id)).toBe(467);
    expect(trimVegetables(getDb(), id)).toMatchObject({ outcome: 'trimmed', before: 467, after: 253 });
    expect(amounts(id)).toMatchObject({ sperziebonen: 430, courgette: 220, cherrytomaat: 110 });
  });

  it('keeps at least half of each vegetable, the onion and what comes by the tin', () => {
    const id = written('Hutspot', [
      veg('winterwortel', 10, 'stuks (ca. 1 kg)'), veg('ui', 2, 'stuks'),
      { name: 'tomatenblokjes uit blik', amount: 1, unit: 'blik', product_group: 'sauzen' },
      veg('broccoli', 800),
    ]);
    expect(trimVegetables(getDb(), id).outcome).toBe('trimmed');
    const after = data(id).ingredients;
    // Half and no less, though that is still over the aim; the weight written next to the count follows
    expect(after.find((i) => i.name === 'winterwortel')).toMatchObject({ amount: 5, unit: 'stuks (ca. 0,5 kg)' });
    expect(amounts(id)).toMatchObject({ ui: 2, 'tomatenblokjes uit blik': 1, broccoli: 400 });
    expect(perAdult(id)).toBeGreaterThan(325);
  });

  it('leaves a soup its vegetables', () => {
    const soup = written('Tomatensoep met linzen', [veg('tomaat', 1500), veg('wortel', 600)], { meal_type: 'soep' });
    const named = written('Courgettesoep met brood', [veg('courgette', 1500)], { meal_type: 'vrij' });
    expect(trimVegetables(getDb(), soup).outcome).toBe('own');
    expect(trimVegetables(getDb(), named).outcome).toBe('own');
    expect(amounts(soup)).toMatchObject({ tomaat: 1500, wortel: 600 });
  });
});

describe('what is left alone', () => {
  it('leaves a recipe at or under the ceiling, one from a cookbook without a top-up, and what is no dinner', () => {
    const fine = recipe('Net genoeg', [veg('courgette', 900)], { source: 'weekmenu' }); // 300 g per adult
    const cookbook = recipe('Ratatouille', [veg('aubergine', 1500)]);
    const cake = recipe('Courgettetaart', [veg('courgette', 1500)], { source: 'weekmenu', course: 'toetje' });
    const archived = recipe('Oud recept', [veg('courgette', 1500)], { source: 'weekmenu', status: 'archief' });

    expect(planTrimOf(getDb(), fine).outcome).toBe('fine');
    expect(planTrimOf(getDb(), cookbook).outcome).toBe('own');
    expect(planTrimOf(getDb(), cake).outcome).toBe('not_dinner');
    expect(planTrimOf(getDb(), archived).outcome).toBe('not_dinner');
  });

  it('does not take the peas that make a dinner a whole meal', () => {
    // The protein of this dinner is its peas: half of them leaves it short
    const id = saveRecipe(getDb(), parseRecipeInput({
      name: 'Pasta met doperwten', servings: 4, status: 'goedgekeurd', meal_type: 'pasta', source: 'weekmenu',
      ingredients: [{ name: 'zilvervliesrijst', amount: 200, unit: 'g', product_group: 'droogwaren' }, veg('doperwten', 1000)], steps: ['Koken.'],
    }));
    expect(getRecipe(getDb(), id)).toMatchObject({ meal_missing: [], veg_per_serving: 333 });
    expect(trimVegetables(getDb(), id).outcome).toBe('meal');
    expect(amounts(id).doperwten).toBe(1000);
    expect(revisions(id)).toEqual([]);
  });
});

describe('once, and the way back', () => {
  const written = () => recipe('Zalm met sperziebonen', [veg('sperziebonen', 800), veg('courgette', 400), veg('cherrytomaat', 200)], { source: 'weekmenu' });

  it('keeps the recipe as it was to go back to, and does not take the same part off twice', () => {
    const id = written();
    trimVegetables(getDb(), id);
    expect(getRecipe(getDb(), id).veg_trim).toMatchObject({ veg_before: 467, veg_after: 253, summary: 'Minder sperziebonen, courgette en cherrytomaat.' });

    // Still over the aim by rounding or not: once is enough
    expect(trimVegetables(getDb(), id).outcome).toBe('done');
    expect(amounts(id)).toMatchObject({ sperziebonen: 430, courgette: 220, cherrytomaat: 110 });
  });

  it('puts the recipe back, and leaves it alone in a later run', () => {
    const id = written();
    trimVegetables(getDb(), id);
    revertTrim(getDb(), id);
    expect(amounts(id)).toMatchObject({ sperziebonen: 800, courgette: 400, cherrytomaat: 200 });
    expect(getRecipe(getDb(), id).veg_trim).toBeNull();
    expect(trimAllVegetables(getDb()).counts).toMatchObject({ trimmed: 0, done: 1 });
    expect(amounts(id).sperziebonen).toBe(800);
    expect(() => revertTrim(getDb(), id)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('goes with the top-up when that is undone', () => {
    const id = toppedUp('Pasta garnalen', [veg('courgette', 300)], [veg('courgette', 600), veg('spinazie', 600), veg('cherrytomaat', 300)]);
    trimVegetables(getDb(), id);
    expect(revisions(id)).toEqual(['groente', 'groente-minder']);

    revertVegetables(getDb(), id);
    expect(amounts(id)).toEqual({ 'volkoren spaghetti': 400, garnalen: 400, courgette: 300 });
    expect(revisions(id)).toEqual([]);
    expect(getRecipe(getDb(), id)).toMatchObject({ veg_revision: null, veg_trim: null });
  });
});

describe('the whole library', () => {
  it('says what it would do without doing it, then does it, shopping lists included', () => {
    const big = recipe('Zalm met sperziebonen', [veg('sperziebonen', 800), veg('courgette', 400), veg('cherrytomaat', 200)], { source: 'weekmenu' });
    const fine = recipe('Net genoeg', [veg('prei', 900)], { source: 'weekmenu' });
    const cookbook = recipe('Ratatouille', [veg('aubergine', 1500)]);
    const menu = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: big }, { day_name: 'Vrijdag', recipe_id: fine }] }, 47, 2026);
    const onList = () => (getDb().prepare("SELECT quantity FROM shopping_items WHERE menu_id = ? AND item_name = 'sperziebonen'").get(menu) as { quantity: string }).quantity;
    expect(onList()).toBe('800 g');

    const preview = trimAllVegetables(getDb(), { dryRun: true });
    expect(preview.counts).toEqual({ trimmed: 1, fine: 1, done: 0, own: 1, meal: 0, not_dinner: 0 });
    expect(preview.trimmed).toEqual([{ id: big, name: 'Zalm met sperziebonen', before: 467, after: 253, summary: 'Minder sperziebonen, courgette en cherrytomaat.' }]);
    expect(amounts(big).sperziebonen).toBe(800);
    expect(revisions(big)).toEqual([]);

    expect(trimAllVegetables(getDb()).counts.trimmed).toBe(1);
    expect(amounts(big).sperziebonen).toBe(430);
    expect(amounts(cookbook).aubergine).toBe(1500);
    // The week that is planned buys and cooks the new amounts
    expect(onList()).toBe('430 g');
    const day = getDb().prepare('SELECT recipe_data FROM menu_days WHERE menu_id = ? AND recipe_id = ?').get(menu, big) as { recipe_data: string };
    expect(JSON.parse(day.recipe_data).ingredients.find((i: Ingredient) => i.name === 'sperziebonen').amount).toBe(430);
  });
});

describe('over the API', () => {
  const post = (url: string, body: unknown = {}) => fetch(`${base}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });

  it('brings one recipe back and puts it back, and says why when there is nothing to do', async () => {
    const id = recipe('Zalm met sperziebonen', [veg('sperziebonen', 800), veg('courgette', 400), veg('cherrytomaat', 200)], { source: 'weekmenu' });
    const cookbook = recipe('Ratatouille', [veg('aubergine', 1500)]);

    const trimmed = await (await post(`/api/recipes/${id}/vegetables/trim`)).json();
    expect(trimmed).toMatchObject({ outcome: 'trimmed', recipe: { veg_per_serving: 253, veg_trim: { veg_before: 467, veg_after: 253 } } });
    expect((await (await post(`/api/recipes/${cookbook}/vegetables/trim`)).json()).outcome).toBe('own');

    const back = await (await post(`/api/recipes/${id}/vegetables/trim/revert`)).json();
    expect(back).toMatchObject({ veg_per_serving: 467, veg_trim: null });
    expect((await post(`/api/recipes/${id}/vegetables/trim/revert`)).status).toBe(404);
    expect((await post('/api/recipes/99999/vegetables/trim')).status).toBe(404);
  });

  it('counts what is over the ceiling and brings the library back in one go', async () => {
    recipe('Zalm met sperziebonen', [veg('sperziebonen', 800), veg('courgette', 400), veg('cherrytomaat', 200)], { source: 'weekmenu' });
    recipe('Net genoeg', [veg('prei', 900)], { source: 'weekmenu' });
    const overview = async () => (await fetch(`${base}/api/vegetables`, { headers: { Cookie: cookie } })).json();
    expect(await overview()).toMatchObject({ target: 250, minimum: 175, ceiling: 325, counts: { dinners: 2, above: 1, below: 0 } });

    expect((await (await post('/api/vegetables/trim', { dry_run: true })).json()).counts.trimmed).toBe(1);
    expect((await overview()).counts.above).toBe(1);
    expect((await (await post('/api/vegetables/trim')).json()).counts.trimmed).toBe(1);
    expect((await overview()).counts.above).toBe(0);
    expect((await post('/api/vegetables/trim', { dry_run: 'ja' })).status).toBe(400);
  });
});
