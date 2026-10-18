// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'weekmenu-extras-'));
process.env.DATABASE_PATH = path.join(DIR, 'weekmenu.db');
process.env.NODE_ENV = 'test';

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, updateRecipe, parseRecipeInput, getRecipe, recipeInputOf } = await import('../server/services/recipes');
const { importMenu, previewMenu, MenuImportError } = await import('../server/services/menu-generator');
const { buildPlanningBrief } = await import('../server/services/planning');
const { menuExtras } = await import('../server/services/menu-days');
const { generateShoppingList } = await import('../server/services/shopping-generator');
const { createSession, hashPassword } = await import('../server/services/auth');
const { default: app } = await import('../server/index');

type Ingredient = { name: string; amount: number; unit: string; product_group: string };

function recipe(name: string, overrides: Record<string, unknown> = {}) {
  return saveRecipe(getDb(), parseRecipeInput({
    name,
    status: 'goedgekeurd',
    meal_type: 'soep',
    prep_time_minutes: 30,
    ingredients: [{ name: 'rode linzen', amount: 250, unit: 'g', product_group: 'droogwaren' }],
    steps: ['Koken'],
    ...overrides,
  }));
}

const OATS: Ingredient[] = [{ name: 'havermout', amount: 200, unit: 'g', product_group: 'droogwaren' }];
const breakfast = (name: string, ingredients = OATS, servings = 4) =>
  recipe(name, { course: 'ontbijt', meal_type: null, prep_time_minutes: 10, servings, ingredients });
const snack = (name: string, ingredients = OATS, servings = 4) =>
  recipe(name, { course: 'snack', meal_type: null, prep_time_minutes: 15, servings, ingredients });

/** The ingredient rows the shopping list is computed from. */
const ingredientNames = (recipeId: number) => (getDb().prepare(`
  SELECT i.name FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = ? ORDER BY ri.id
`).all(recipeId) as Array<{ name: string }>).map((r) => r.name);

const newSnack = {
  recipe_name: 'Appel-kaneelmuffins',
  prep_time_minutes: 35,
  recipe: {
    servings: 12,
    ingredients: [
      { name: 'volkorenmeel', amount: 250, unit: 'g', product_group: 'droogwaren' },
      { name: 'appel', amount: 2, unit: 'stuks', product_group: 'fruit' },
    ],
    steps: ['Meng', 'Bak 25 minuten'],
    nutrition_per_serving: { calories: 150, protein_g: 4, fiber_g: 3, iron_mg: 1 },
  },
};

const extrasOf = (menuId: number) => menuExtras(getDb(), [menuId]);
const shopping = (menuId: number) => getDb().prepare(
  'SELECT item_name, quantity, for_days FROM shopping_items WHERE menu_id = ? ORDER BY item_name',
).all(menuId) as Array<{ item_name: string; quantity: string; for_days: string }>;

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
  getDb().exec('DELETE FROM menus; DELETE FROM recipe_ingredients; DELETE FROM recipes; DELETE FROM ingredients;');
});

describe('breakfasts and snacks in a menu import', () => {
  it('plans them from the library by id, with a day when they belong to one', () => {
    const soup = recipe('Linzensoep');
    const oats = breakfast('Overnight oats', [{ name: 'havermout', amount: 200, unit: 'g', product_group: 'droogwaren' }]);
    const pancakes = breakfast('Volkoren pannenkoeken', [{ name: 'volkorenmeel', amount: 250, unit: 'g', product_group: 'droogwaren' }]);
    const balls = snack('Energy balls', [{ name: 'dadels', amount: 200, unit: 'g', product_group: 'droogwaren' }], 12);

    const menuId = importMenu({
      days: [{ day_name: 'Donderdag', recipe_id: soup }],
      breakfasts: [
        { recipe_id: oats, recipe_name: 'Overnight oats' },
        { recipe_id: pancakes, recipe_name: 'Volkoren pannenkoeken', day_name: 'Zondag' },
      ],
      snacks: [{ recipe_id: balls }],
    }, 42, 2026);

    expect(extrasOf(menuId).map(({ kind, recipe_name, day_name, date, prep_time_minutes }) =>
      ({ kind, recipe_name, day_name, date, prep_time_minutes }))).toEqual([
      { kind: 'ontbijt', recipe_name: 'Overnight oats', day_name: null, date: null, prep_time_minutes: 10 },
      // Week 42 of 2026 runs from Thursday 15 October: its Sunday is the 18th
      { kind: 'ontbijt', recipe_name: 'Volkoren pannenkoeken', day_name: 'Zondag', date: '2026-10-18', prep_time_minutes: 10 },
      { kind: 'snack', recipe_name: 'Energy balls', day_name: null, date: null, prep_time_minutes: 15 },
    ]);
    // Planned counts as used, as for dinners; the dinners are untouched
    expect(getRecipe(getDb(), oats)!.times_used).toBe(1);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM menu_days WHERE menu_id = ?').get(menuId)).toEqual({ n: 1 });
  });

  it('adds a new one written out to the library as a concept of its kind', () => {
    const soup = recipe('Linzensoep');
    const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], snacks: [newSnack] }, 42, 2026);

    const [extra] = extrasOf(menuId);
    expect(extra).toMatchObject({ kind: 'snack', recipe_name: 'Appel-kaneelmuffins', prep_time_minutes: 35 });
    const saved = getRecipe(getDb(), extra.recipe_id)!;
    expect(saved).toMatchObject({ status: 'concept', course: 'snack', main_course: false, servings: 12 });
    expect(ingredientNames(extra.recipe_id)).toEqual(['volkorenmeel', 'appel']);
  });

  it('keeps an approved recipe of the same name as it is', () => {
    const soup = recipe('Linzensoep');
    const approved = snack('Appel-kaneelmuffins', [{ name: 'appel', amount: 4, unit: 'stuks', product_group: 'fruit' }], 12);

    const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], snacks: [newSnack] }, 42, 2026);

    expect(extrasOf(menuId)[0].recipe_id).toBe(approved);
    expect(ingredientNames(approved)).toEqual(['appel']);
  });

  it('refuses an unknown id, an archived recipe and a name that belongs to another, saying which one', () => {
    const soup = recipe('Linzensoep');
    const oats = breakfast('Overnight oats');
    const old = snack('Oude koek', OATS, 12);
    getDb().prepare("UPDATE recipes SET status = 'archief' WHERE id = ?").run(old);
    const before = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], breakfasts: [{ recipe_id: oats }] }, 42, 2026);

    const attempt = (menu: Record<string, unknown>) => () => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], ...menu }, 42, 2026);
    expect(attempt({ breakfasts: [{ recipe_id: oats }, { recipe_id: 9999 }] }))
      .toThrow(new MenuImportError('Ontbijt 2: recept #9999 staat niet in de bibliotheek'));
    expect(attempt({ snacks: [{ recipe_id: old }] }))
      .toThrow(new MenuImportError(`Tussendoortje 1: recept #${old} "Oude koek" is gearchiveerd`));
    expect(attempt({ breakfasts: [{ recipe_id: oats, recipe_name: 'Pannenkoeken' }] }))
      .toThrow(/Ontbijt 1: recept #\d+ heet "Overnight oats", niet "Pannenkoeken"/);
    // An invalid id never turns into a new recipe that loses it
    expect(attempt({ snacks: [{ recipe_id: 'abc', recipe_name: 'Energy balls' }] })).toThrow();

    // A refused import leaves the week as it was
    expect(extrasOf(before).map((e) => e.recipe_id)).toEqual([oats]);
  });

  it('replaces the extras with the week when that week is imported again', () => {
    const soup = recipe('Linzensoep');
    const oats = breakfast('Overnight oats');
    const pancakes = breakfast('Volkoren pannenkoeken');
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], breakfasts: [{ recipe_id: oats }] }, 42, 2026);
    const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], breakfasts: [{ recipe_id: pancakes }] }, 42, 2026);

    expect(getDb().prepare('SELECT recipe_id FROM menu_extras').all()).toEqual([{ recipe_id: pancakes }]);
    expect(extrasOf(menuId)[0].recipe_name).toBe('Volkoren pannenkoeken');
  });

  it('shows them in the preview, marking new ones, and stores nothing', () => {
    const soup = recipe('Linzensoep');
    const oats = breakfast('Overnight oats');

    const preview = previewMenu({
      days: [{ day_name: 'Donderdag', recipe_id: soup }],
      breakfasts: [{ recipe_id: oats, day_name: 'Zaterdag' }],
      snacks: [newSnack],
    }, 42, 2026);

    expect(preview.extras.map(({ kind, recipe_name, day_name, date, new_recipe }) => ({ kind, recipe_name, day_name, date, new_recipe }))).toEqual([
      { kind: 'ontbijt', recipe_name: 'Overnight oats', day_name: 'Zaterdag', date: '2026-10-17', new_recipe: false },
      { kind: 'snack', recipe_name: 'Appel-kaneelmuffins', day_name: null, date: null, new_recipe: true },
    ]);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM menu_extras').get()).toEqual({ n: 0 });
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM recipes WHERE name = 'Appel-kaneelmuffins'").get()).toEqual({ n: 0 });
  });
});

describe('breakfasts and snacks on the shopping list', () => {
  it('lists their ingredients under their kind: breakfast for the household, a snack made whole', () => {
    const soup = recipe('Linzensoep', { ingredients: [{ name: 'appel', amount: 1, unit: 'stuks', product_group: 'fruit' }] });
    // For 2: doubled to the household's 4
    const oats = breakfast('Overnight oats', [
      { name: 'havermout', amount: 100, unit: 'g', product_group: 'droogwaren' },
      { name: 'appel', amount: 1, unit: 'stuks', product_group: 'fruit' },
    ], 2);
    // 12 balls: one batch, whatever the household
    const balls = snack('Energy balls', [{ name: 'dadels', amount: 200, unit: 'g', product_group: 'droogwaren' }], 12);

    const menuId = importMenu({
      days: [{ day_name: 'Donderdag', recipe_id: soup }],
      breakfasts: [{ recipe_id: oats }],
      snacks: [{ recipe_id: balls }],
    }, 42, 2026);

    expect(shopping(menuId)).toEqual([
      { item_name: 'appel', quantity: '3 stuks', for_days: '["Donderdag","Ontbijt"]' },
      { item_name: 'dadels', quantity: '200 g', for_days: '["Tussendoortje"]' },
      { item_name: 'havermout', quantity: '200 g', for_days: '["Ontbijt"]' },
    ]);

    // Eating the dinners leaves the week's breakfasts and snacks to shop for
    getDb().prepare("UPDATE menu_days SET status = 'completed' WHERE menu_id = ?").run(menuId);
    generateShoppingList(menuId);
    expect(shopping(menuId).map((i) => i.item_name)).toEqual(['appel', 'dadels', 'havermout']);
  });

  it('follows an edit of a recipe that is only planned as a breakfast', () => {
    const soup = recipe('Linzensoep');
    const oats = breakfast('Overnight oats', [{ name: 'havermout', amount: 200, unit: 'g', product_group: 'droogwaren' }]);
    const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], breakfasts: [{ recipe_id: oats }] }, 42, 2026);

    const input = recipeInputOf(getRecipe(getDb(), oats)!);
    updateRecipe(getDb(), { ...input, ingredients: [...input.ingredients, { name: 'blauwe bessen', amount: 125, unit: 'g', product_group: 'fruit' }] }, oats);

    expect(shopping(menuId).map((i) => i.item_name)).toContain('blauwe bessen');
  });
});

describe('breakfasts and snacks in the planning brief', () => {
  it('offers them, approved before concepts, and asks for new ones when there are too few', () => {
    const oats = breakfast('Overnight oats', [{ name: 'havermout', amount: 200, unit: 'g', product_group: 'droogwaren' }]);
    recipe('Hartige havermout', { course: 'ontbijt', status: 'archief' });
    const balls = snack('Energy balls', [{ name: 'dadels', amount: 200, unit: 'g', product_group: 'droogwaren' }], 12);
    const muffins = snack('Muffins', [{ name: 'volkorenmeel', amount: 250, unit: 'g', product_group: 'droogwaren' }], 12);
    getDb().prepare("UPDATE recipes SET status = 'concept' WHERE id = ?").run(muffins);

    const { text } = buildPlanningBrief(getDb(), new Date('2026-10-15T12:00:00Z'));

    expect(text).toContain(`## Ontbijt (2 per week)\n\nKies 2 ontbijten`);
    expect(text).toContain('De bibliotheek heeft er maar 1: vul aan met een nieuw recept, volledig uitgeschreven.');
    expect(text).toContain(`Goedgekeurd:\n#${oats} Overnight oats — 10 min\n   havermout`);
    expect(text).not.toContain('Hartige havermout');
    expect(text).toContain('## Gezonde tussendoortjes (2 per week)');
    expect(text).toContain(`#${balls} Energy balls — 15 min\n   dadels\n\nNog niet geprobeerd (concept):\n#${muffins} Muffins — 15 min`);
    expect(text).toContain('"breakfasts": [');
    expect(text).toContain('"snacks": [');
    expect(text).not.toContain('snack_suggestions');
  });

  it('says there are none yet, and lists last weeks\' breakfasts and snacks as planned', () => {
    const soup = recipe('Linzensoep');
    const balls = snack('Energy balls', OATS, 12);
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], snacks: [{ recipe_id: balls }, newSnack] }, 42, 2026);

    const { text } = buildPlanningBrief(getDb(), new Date('2026-10-15T12:00:00Z'));

    expect(text).toContain('## Ontbijt (2 per week)\n\nKies 2 ontbijten voor de dagen dat er tijd voor is, zoals het weekend.\n'
      + 'De bibliotheek heeft er nog geen: vul aan met een nieuw recept, volledig uitgeschreven.');
    expect(text).toContain('Week 42:\n- Donderdag: Linzensoep\n- Tussendoortje: Energy balls\n- Tussendoortje: Appel-kaneelmuffins');
  });
});

describe('the week view', () => {
  // The app archives a week once its last day is past, so the clock must stand
  // inside week 42 of 2026 for the menu to still be active. Only Date is faked:
  // the server runs in this process and the fetch below needs real timers.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 15, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('gets the breakfasts and snacks of every active week with the menu', async () => {
    const soup = recipe('Linzensoep');
    const oats = breakfast('Overnight oats');
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soup }], breakfasts: [{ recipe_id: oats, day_name: 'Zaterdag' }] }, 42, 2026);

    const res = await fetch(`${base}/api/menus/active`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const menu = await res.json();
    expect(menu.extras).toEqual([expect.objectContaining({
      kind: 'ontbijt', recipe_id: oats, recipe_name: 'Overnight oats', day_name: 'Zaterdag', date: '2026-10-17',
    })]);
  });
});
