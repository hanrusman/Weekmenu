// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-servings-'));
process.env.DATABASE_PATH = path.join(DIR, 'weekmenu.db');
process.env.NODE_ENV = 'test';
process.env.LITELLM_URL = 'http://litellm.test:4000';
process.env.LITELLM_API_KEY = 'test-key';

const { getDb, closeDb } = await import('../server/db');
const { scaleAmount, scaleStep, scaleRecipe, forHousehold, normalizeServings, normalizeAllServings } = await import('../server/services/servings');
const { saveRecipe, parseRecipeInput, getRecipe } = await import('../server/services/recipes');
const { importRecipeText } = await import('../server/services/recipe-parser');
const { boostRecipe, revertVegetables } = await import('../server/services/vegetable-boost');
const { createSession, hashPassword } = await import('../server/services/auth');
const { default: app } = await import('../server/index');

type Ingredient = { name: string; amount: number | string | null; unit: string; product_group: string };

const forTwo = {
  name: 'Pasta met courgette', servings: 2, status: 'goedgekeurd',
  ingredients: [
    { name: 'spaghetti', amount: 180, unit: 'g', product_group: 'droogwaren' },
    { name: 'courgette', amount: 1, unit: 'stuks', product_group: 'groenten' },
    { name: 'olijfolie', amount: 1.5, unit: 'el', product_group: 'olie' },
    { name: 'zout', amount: 1, unit: 'snufje', product_group: 'kruiden' },
    { name: 'peper', amount: null, unit: '', product_group: 'kruiden' },
  ] as Ingredient[],
  steps: ['Kook de spaghetti 9 minuten.', 'Verhit 1,5 el olijfolie en bak de courgette in blokjes van 2 cm.', 'Verdeel over 2 borden.'],
  nutrition_per_serving: { calories: 550, protein_g: 18, fiber_g: 7, iron_mg: 3 },
};

const save = (recipe: Record<string, unknown>) => saveRecipe(getDb(), parseRecipeInput(recipe));
const data = (id: number) => JSON.parse(getRecipe(getDb(), id).recipe_data as string);

afterAll(() => {
  closeDb();
  fs.rmSync(DIR, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec('DELETE FROM recipe_revisions; DELETE FROM recipe_ingredients; DELETE FROM recipes;');
});

afterEach(() => vi.restoreAllMocks());

describe('scaling amounts', () => {
  it('rounds grams and millilitres to what you would weigh, the rest to halves', () => {
    expect(scaleAmount(125, 'g', 2)).toBe(250);
    expect(scaleAmount(400, 'g', 4 / 6)).toBe(270);
    expect(scaleAmount(1500, 'ml', 2)).toBe(3000);
    expect(scaleAmount(7, 'g', 4 / 6)).toBe(5);
    expect(scaleAmount(3, 'el', 4 / 6)).toBe(2);
    expect(scaleAmount(1, 'el', 4 / 6)).toBe(0.5);
    expect(scaleAmount(1, 'stuks', 4 / 12)).toBe(0.5);
    expect(scaleAmount(3, 'stuks', 4 / 6)).toBe(2);
    expect(scaleAmount(1.2, 'kg', 4 / 6)).toBe(0.8);
    // Sprigs stay whole
    expect(scaleAmount(1, 'takje', 4 / 6)).toBe(1);
    expect(scaleAmount(2, 'takje', 4 / 6)).toBe(1);
    expect(scaleAmount(2, 'takje', 2)).toBe(4);
  });

  it('leaves a pinch, no amount and "naar smaak" alone, and scales numbers and ranges written as text', () => {
    expect(scaleAmount(1, 'snufje', 2)).toBe(1);
    expect(scaleAmount(null, '', 2)).toBeNull();
    expect(scaleAmount('naar smaak', '', 2)).toBe('naar smaak');
    expect(scaleAmount('1,5', 'el', 2)).toBe(3);
    expect(scaleAmount('1-2', 'teen', 2)).toBe('2-4');
    expect(scaleAmount('½', 'tl', 2)).toBe(1);
  });
});

describe('scaling the steps', () => {
  it('scales measures and plates, not times, temperatures or sizes', () => {
    expect(scaleStep('Verhit 2 el olijfolie en bak 4 minuten.', 2)).toBe('Verhit 4 el olijfolie en bak 4 minuten.');
    expect(scaleStep('Giet er 300 ml kokend water over.', 2)).toBe('Giet er 600 ml kokend water over.');
    expect(scaleStep('Snijd in blokjes van 2 cm en rooster 25 min op 200 graden (200°C).', 2))
      .toBe('Snijd in blokjes van 2 cm en rooster 25 min op 200 graden (200°C).');
    expect(scaleStep('Verdeel over 2 borden.', 2)).toBe('Verdeel over 4 borden.');
    expect(scaleStep('Voeg 180 g spaghetti toe.', 4 / 6)).toBe('Voeg 120 g spaghetti toe.');
  });

  it('reads decimals, fractions and ranges', () => {
    expect(scaleStep('Meng 1,5 el honing met ½ tl zout.', 2)).toBe('Meng 3 el honing met 1 tl zout.');
    expect(scaleStep('Pers 2-3 teentjes knoflook.', 2)).toBe('Pers 4-6 teentjes knoflook.');
    expect(scaleStep('Doe er 1/2 l bouillon bij.', 2)).toBe('Doe er 1 l bouillon bij.');
  });
});

describe('a recipe for the household', () => {
  it('scales amounts and steps to four servings, keeping the estimate per serving', () => {
    const scaled = scaleRecipe(parseRecipeInput(forTwo));
    expect(scaled.servings).toBe(4);
    expect(scaled.ingredients.map((i) => i.amount)).toEqual([360, 2, 3, 1, null]);
    expect(scaled.steps).toEqual(['Kook de spaghetti 9 minuten.', 'Verhit 3 el olijfolie en bak de courgette in blokjes van 2 cm.', 'Verdeel over 4 borden.']);
    expect(scaled.nutrition_per_serving).toEqual(forTwo.nutrition_per_serving);
  });

  it('rounds vegetables up, so rounding never takes a recipe below the vegetable aim', () => {
    const forSix = parseRecipeInput({ ...forTwo, servings: 6, ingredients: [
      { name: 'courgette', amount: 1, unit: 'stuks', product_group: 'groenten' },
      { name: 'ei', amount: 1, unit: 'stuks', product_group: 'zuivel' },
      { name: 'spinazie', amount: 520, unit: 'g', product_group: 'groenten' },
      { name: 'feta', amount: 130, unit: 'g', product_group: 'zuivel' },
    ] });
    // 4/6 of: 0.67 courgette (up), 0.67 ei (nearest half), 347 g spinazie (up), 87 g feta (nearest 5)
    expect(scaleRecipe(forSix).ingredients.map((i) => i.amount)).toEqual([1, 0.5, 350, 85]);
  });

  it('gives a step the same rounded-up amount as the vegetable it names', () => {
    const forSix = parseRecipeInput({ ...forTwo, servings: 6, ingredients: [
      { name: 'spinazie', amount: 500, unit: 'g', product_group: 'groenten' },
      { name: 'tomaat', amount: 500, unit: 'g', product_group: 'groenten' },
      { name: 'pasta', amount: 500, unit: 'g', product_group: 'droogwaren' },
    ], steps: [
      'Voeg 500 g spinazie toe.',
      'Bak 500 g tomaten mee.',
      'Kook 500 g pasta in 500 g water.',
    ] });
    const scaled = scaleRecipe(forSix);
    // 333 g each: vegetables rounded up to 340, the rest to 330, in the list and in the steps alike
    expect(scaled.ingredients.map((i) => i.amount)).toEqual([340, 340, 330]);
    expect(scaled.steps).toEqual(['Voeg 340 g spinazie toe.', 'Bak 340 g tomaten mee.', 'Kook 330 g pasta in 330 g water.']);
  });

  it('does the same for a range of a vegetable', () => {
    const forSix = parseRecipeInput({ ...forTwo, servings: 6, ingredients: [
      { name: 'spinazie', amount: '500-600', unit: 'g', product_group: 'groenten' },
    ], steps: ['Voeg 500-600 g spinazie toe.', 'Of alleen 500 g spinazie.'] });
    const scaled = scaleRecipe(forSix);
    expect(scaled.ingredients[0].amount).toBe('340-400');
    // The single amount is not the list's range: rounded on its own
    expect(scaled.steps).toEqual(['Voeg 340-400 g spinazie toe.', 'Of alleen 330 g spinazie.']);
  });

  it('leaves baking and batches as they are', () => {
    const cake = parseRecipeInput({ ...forTwo, name: 'Taart', servings: 12, course: 'toetje' });
    const balls = parseRecipeInput({ ...forTwo, name: 'Balletjes', servings: 20, course: 'snack' });
    expect(forHousehold(cake)).toBe(cake);
    expect(forHousehold(balls)).toBe(balls);
    expect(forHousehold(parseRecipeInput({ ...forTwo, course: 'lunch' })).servings).toBe(4);
  });
});

describe('the library to the household', () => {
  it('saves the recipe for four, keeps the original as revision and the vegetables per serving', () => {
    const id = save(forTwo);
    const before = getRecipe(getDb(), id).veg_per_serving;

    expect(normalizeServings(getDb(), id)).toBe('scaled');
    expect(data(id)).toMatchObject({ servings: 4, steps: expect.arrayContaining(['Verdeel over 4 borden.']) });
    expect(data(id).ingredients[0]).toMatchObject({ name: 'spaghetti', amount: 360 });
    expect(getRecipe(getDb(), id).veg_per_serving).toBe(before);
    const revision = getDb().prepare("SELECT input, summary FROM recipe_revisions WHERE recipe_id = ? AND reason = 'porties'").get(id) as
      { input: string; summary: string };
    expect(JSON.parse(revision.input)).toMatchObject({ servings: 2 });
    expect(revision.summary).toBe('2 → 4 personen');
  });

  it('scales the original of a vegetable top-up too, so undoing it keeps four servings', async () => {
    const id = save(forTwo);
    const more = [...forTwo.ingredients,
      { name: 'spinazie', amount: 500, unit: 'g', product_group: 'groenten' },
      { name: 'kipfilet', amount: 200, unit: 'g', product_group: 'vlees' }];
    expect((await boostRecipe(getDb(), id, vi.fn().mockResolvedValue(JSON.stringify({
      course: 'hoofdgerecht', ingredients: more, steps: forTwo.steps, summary: 'Spinazie en kip erdoor.',
    })))).outcome).toBe('boosted');
    expect(data(id).servings).toBe(2);

    normalizeServings(getDb(), id);
    revertVegetables(getDb(), id);
    expect(data(id)).toMatchObject({ servings: 4 });
    expect(data(id).ingredients.map((i: Ingredient) => i.name)).not.toContain('spinazie');
    expect(data(id).ingredients[0]).toMatchObject({ amount: 360 });
  });

  it('counts what it did, leaving four-person recipes, baking and batches', () => {
    save(forTwo);
    save({ ...forTwo, name: 'Al voor vier', servings: 4 });
    save({ ...forTwo, name: 'Taart', servings: 12, course: 'toetje' });
    expect(normalizeAllServings(getDb())).toEqual({ scaled: 1, unchanged: 1, not_scaled: 1 });
    expect(normalizeAllServings(getDb())).toEqual({ scaled: 0, unchanged: 2, not_scaled: 1 });
  });
});

describe('imports for the household', () => {
  function modelReturns(recipe: Record<string, unknown>) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('http://litellm.test')) {
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  it('stores a recipe read from a cookbook for four', async () => {
    modelReturns(forTwo);
    const recipe = await importRecipeText(getDb(), 'tekst', {}) as { recipe_data: string };
    expect(JSON.parse(recipe.recipe_data)).toMatchObject({ servings: 4 });
  });

  describe('over HTTP', () => {
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

    afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const post = (route: string, body: unknown) => fetch(`${base}/api/recipes${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
    });

    it('shows a pasted recipe for four', async () => {
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => (String(url).startsWith('http://litellm.test')
        ? new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(forTwo) } }] }), { status: 200 })
        : realFetch(url, init)));
      const res = await post('/parse', { text: 'Pasta voor 2' });
      expect(res.status).toBe(200);
      const { draft } = await res.json();
      expect(draft).toMatchObject({ servings: 4, ingredients: expect.arrayContaining([expect.objectContaining({ name: 'spaghetti', amount: 360 })]) });
    });

    it('scales a bulk import, but not a recipe added by hand', async () => {
      const bulk = await (await post('?household=1', { ...forTwo, name: 'Uit de bulk' })).json();
      const byHand = await (await post('', { ...forTwo, name: 'Met de hand' })).json();
      expect(JSON.parse(bulk.recipe_data).servings).toBe(4);
      expect(JSON.parse(byHand.recipe_data).servings).toBe(2);
    });
  });
});
