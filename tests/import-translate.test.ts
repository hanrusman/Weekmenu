// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-translate-'));
process.env.DATABASE_PATH = path.join(DIR, 'weekmenu.db');
process.env.NODE_ENV = 'test';
process.env.LITELLM_URL = 'http://litellm.test:4000';
process.env.LITELLM_API_KEY = 'test-key';

const { getDb, closeDb } = await import('../server/db');
const { looksEnglish } = await import('../server/services/translate');
const { createSession, hashPassword } = await import('../server/services/auth');
const { default: app } = await import('../server/index');

/** As a bulk JSON converter delivered it from Pick Up Limes, untranslated. */
const english = {
  name: 'Creamy Tomato Chickpea Curry', servings: 2, status: 'concept', source: 'Pick Up Limes.json',
  ingredients: [
    { name: 'vegetable oil', amount: 1, unit: 'el', product_group: 'olie' },
    { name: 'large onion', amount: 1, unit: 'stuks', product_group: 'groenten' },
    { name: 'garlic clove', amount: 3, unit: 'stuks', product_group: 'groenten' },
    { name: 'canned chickpeas', amount: 400, unit: 'g', product_group: 'droogwaren' },
    { name: 'spinach', amount: 100, unit: 'g', product_group: 'groenten' },
  ],
  steps: ['Heat the oil in a large pan and add the onion.', 'Add the garlic and cook for 2 minutes, then stir in the chickpeas.'],
};

/** What the parser makes of it. */
const dutch = {
  name: 'Romige tomaat-kikkererwtencurry', servings: 2, meal_type: 'rijst', course: 'hoofdgerecht', prep_time_minutes: 25,
  ingredients: [
    { name: 'plantaardige olie', amount: 1, unit: 'el', product_group: 'olie' },
    { name: 'ui', amount: 1, unit: 'stuks', product_group: 'groenten', note: 'groot' },
    { name: 'knoflook', amount: 3, unit: 'teen', product_group: 'groenten' },
    { name: 'kikkererwten uit blik', amount: 400, unit: 'g', product_group: 'droogwaren' },
    { name: 'spinazie', amount: 100, unit: 'g', product_group: 'groenten' },
  ],
  steps: ['Verhit de olie in een grote pan en voeg de ui toe.', 'Voeg de knoflook toe en bak 2 minuten; roer de kikkererwten erdoor.'],
};

let parserCalls = 0;
/** The parser's answers in turn; the last one repeats. */
function parserReturns(...answers: unknown[]) {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).startsWith('http://litellm.test')) {
      const recipe = answers[Math.min(parserCalls, answers.length - 1)];
      parserCalls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }), { status: 200 });
    }
    return realFetch(url, init);
  });
}

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
  parserCalls = 0;
  getDb().exec('DELETE FROM recipe_ingredients; DELETE FROM recipes;');
});

afterEach(() => vi.restoreAllMocks());

const post = (query: string, body: unknown) => fetch(`${base}/api/recipes${query}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
});

describe('telling English from Dutch', () => {
  it('knows an English recipe, and a Dutch one with loanwords for Dutch', () => {
    expect(looksEnglish(english)).toBe(true);
    expect(looksEnglish(dutch)).toBe(false);
    expect(looksEnglish({
      name: 'Wraps met pesto en curry', ingredients: [{ name: 'tortilla wraps' }, { name: 'groene pesto' }, { name: 'currypasta' }] as never,
      steps: ['Bak de kip met de currypasta en vul de wraps.', 'Serveer met de pesto.'],
    })).toBe(false);
  });
});

describe('a bulk import in English', () => {
  it('is saved in Dutch, for the household, keeping its status and source', async () => {
    parserReturns(dutch);
    const res = await post('?household=1', english);
    expect(res.status).toBe(201);
    const saved = await res.json();
    const data = JSON.parse(saved.recipe_data);
    expect(saved).toMatchObject({ name: 'Romige tomaat-kikkererwtencurry', status: 'concept', source: 'Pick Up Limes.json' });
    expect(data.servings).toBe(4);
    expect(data.ingredients.map((i: { name: string }) => i.name)).toEqual(['plantaardige olie', 'ui', 'knoflook', 'kikkererwten uit blik', 'spinazie']);
    expect(data.steps[0]).toBe('Verhit de olie in een grote pan en voeg de ui toe.');
  });

  it('is refused, not saved in English, when the translation lost ingredients', async () => {
    parserReturns({ ...dutch, ingredients: dutch.ingredients.slice(0, 2) });
    const res = await post('?household=1', english);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/Vertalen mislukt: 2 van de 5/);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM recipes').get()).toEqual({ n: 0 });
  });

  it('keeps what needs no translating as delivered: time, cost, nutrition, servings', async () => {
    parserReturns({ ...dutch, prep_time_minutes: 25, nutrition_per_serving: { calories: 300, protein_g: 10, fiber_g: 5, iron_mg: 2 } });
    const nutrition = { calories: 520, protein_g: 21, fiber_g: 12, iron_mg: 5 };
    const res = await post('?household=1', { ...english, servings: 4, prep_time_minutes: 90, cost_index: '€€', nutrition_per_serving: nutrition });
    expect(res.status).toBe(201);
    const saved = await res.json();
    expect(saved).toMatchObject({ prep_time_minutes: 90, cost_index: '€€' });
    expect(JSON.parse(saved.recipe_data)).toMatchObject({ servings: 4, nutrition_per_serving: nutrition });
  });

  it('refuses a translation that lost the steps, after one more try', async () => {
    parserReturns({ ...dutch, steps: [] });
    const res = await post('?household=1', english);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('Vertalen mislukt: de bereiding kwam niet terug. Probeer het opnieuw.');
    expect(parserCalls).toBe(2);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM recipes').get()).toEqual({ n: 0 });
  });

  it('refuses an answer that is still English, and takes a second one that is Dutch', async () => {
    parserReturns(english);
    const res = await post('?household=1', english);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/nog Engels/);
    vi.restoreAllMocks();

    parserCalls = 0;
    parserReturns(english, dutch);
    const retried = await post('?household=1', english);
    expect(retried.status).toBe(201);
    expect((await retried.json()).name).toBe('Romige tomaat-kikkererwtencurry');
    expect(parserCalls).toBe(2);
  });

  it('leaves a Dutch import and a recipe added by hand alone', async () => {
    parserReturns(dutch);
    expect((await post('?household=1', { ...dutch, name: 'Al Nederlands' })).status).toBe(201);
    expect((await post('', { ...english, name: 'Met de hand, Engels' })).status).toBe(201);
    expect(parserCalls).toBe(0);
  });
});
