// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-vegetable-boost.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, parseRecipeInput, getRecipe, updateRecipe, setRecipeStatus } = await import('../server/services/recipes');
const { boostRecipe, revertVegetables, droppedIngredients, BOOST_ATTEMPTS } = await import('../server/services/vegetable-boost');
const { recipesToBoost, startVegetableJob, vegetableJob } = await import('../server/services/vegetable-job');
const { RecipeError } = await import('../server/services/recipes');

type Ingredient = { name: string; amount: number | null; unit: string; product_group: string };

const pasta: Ingredient[] = [
  { name: 'volkoren spaghetti', amount: 400, unit: 'g', product_group: 'droogwaren' },
  { name: 'garnalen', amount: 300, unit: 'g', product_group: 'vis' },
  { name: 'courgette', amount: 400, unit: 'g', product_group: 'groenten' }, // 100 g p.p.
];

function recipe(name: string, ingredients: Ingredient[] = pasta, extra: Record<string, unknown> = {}) {
  return saveRecipe(getDb(), parseRecipeInput({
    name, servings: 4, status: 'goedgekeurd', meal_type: 'pasta', ingredients, steps: ['Kook de pasta.'],
    nutrition_per_serving: { calories: 500, protein_g: 30, fiber_g: 6, iron_mg: 3 }, ...extra,
  }));
}

/** A model answer: the given ingredients, valid JSON as asked. */
function answer(ingredients: Ingredient[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    course: 'hoofdgerecht', exception: false, ingredients, steps: ['Kook de pasta.', 'Bak de courgette en spinazie mee.'],
    nutrition_per_serving: { calories: 540, protein_g: 31, fiber_g: 11, iron_mg: 4 },
    summary: 'Meer courgette en spinazie door de saus.', ...extra,
  });
}

const enough: Ingredient[] = [
  ...pasta.slice(0, 2),
  { name: 'courgette', amount: 800, unit: 'g', product_group: 'groenten' },
  { name: 'spinazie', amount: 600, unit: 'g', product_group: 'groenten' }, // 350 g p.p.
];

const row = (id: number) => getDb().prepare('SELECT veg_outcome, veg_note, veg_checked_at FROM recipes WHERE id = ?').get(id) as
  { veg_outcome: string | null; veg_note: string | null; veg_checked_at: string | null };

beforeAll(() => {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

afterAll(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(() => {
  getDb().exec('DELETE FROM recipe_revisions; DELETE FROM recipe_ingredients; DELETE FROM recipes;');
});

describe('topping up one recipe', () => {
  it('drops the old nutrition estimate when the model gives no new one', async () => {
    const id = recipe('Pasta garnalen');
    await boostRecipe(getDb(), id, vi.fn().mockResolvedValue(answer(enough, { nutrition_per_serving: undefined })));
    expect(JSON.parse(getRecipe(getDb(), id).recipe_data as string).nutrition_per_serving).toBeUndefined();
  });

  it('saves the proposal once it reaches the aim, keeping the original as revision', async () => {
    const id = recipe('Pasta garnalen');
    const call = vi.fn().mockResolvedValue(answer(enough));

    expect(await boostRecipe(getDb(), id, call)).toEqual({
      outcome: 'boosted', before: 100, after: 350, note: 'Meer courgette en spinazie door de saus.',
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe(BOOST_ATTEMPTS[0].model);
    expect(call.mock.calls[0][1][1].content).toContain('nu 100 g groente per portie');

    const saved = getRecipe(getDb(), id);
    expect(saved).toMatchObject({ status: 'goedgekeurd', veg_per_serving: 350, main_course: true });
    expect(JSON.parse(saved.recipe_data as string).nutrition_per_serving).toEqual({ calories: 540, protein_g: 31, fiber_g: 11, iron_mg: 4 });
    expect(saved.veg_revision).toMatchObject({ veg_before: 100, veg_after: 350, summary: 'Meer courgette en spinazie door de saus.' });
    expect(row(id)).toMatchObject({ veg_outcome: 'boosted', veg_checked_at: expect.any(String) });
  });

  it('tells the next attempt why a proposal below the aim was refused', async () => {
    const id = recipe('Pasta garnalen');
    const short = [...pasta.slice(0, 2), { name: 'courgette', amount: 800, unit: 'g', product_group: 'groenten' }];
    const call = vi.fn().mockResolvedValueOnce(answer(short)).mockResolvedValueOnce(answer(enough));

    expect((await boostRecipe(getDb(), id, call)).outcome).toBe('boosted');
    expect(call.mock.calls[1][1].at(-1).content).toContain('200 g groente per persoon, onder de 350 g');
  });

  it('gives the main model a roomier second try, then the fallback model', async () => {
    const id = recipe('Pasta garnalen');
    const call = vi.fn()
      .mockRejectedValueOnce(new Error('cloud-glm gaf geen antwoord'))
      .mockRejectedValueOnce(new Error('cloud-glm gaf geen antwoord'))
      .mockResolvedValueOnce(answer(enough));

    expect((await boostRecipe(getDb(), id, call)).outcome).toBe('boosted');
    expect(call.mock.calls.map(([model, , maxTokens]) => [model, maxTokens])).toEqual(
      BOOST_ATTEMPTS.map((a) => [a.model, a.maxTokens]),
    );
    expect(BOOST_ATTEMPTS[0].model).toBe(BOOST_ATTEMPTS[1].model);
    expect(BOOST_ATTEMPTS[1].maxTokens).toBeGreaterThan(BOOST_ATTEMPTS[0].maxTokens);
  });

  it('refuses a proposal that drops an ingredient, and one that is not JSON', async () => {
    const id = recipe('Pasta garnalen');
    const withoutPrawns = enough.filter((i) => i.name !== 'garnalen');
    const call = vi.fn().mockResolvedValueOnce(answer(withoutPrawns)).mockResolvedValue('Hier is een idee: meer groente!');

    expect(await boostRecipe(getDb(), id, call)).toMatchObject({ outcome: 'failed', before: 100 });
    expect(call).toHaveBeenCalledTimes(BOOST_ATTEMPTS.length);
    expect(call.mock.calls[1][1].at(-1).content).toContain('ingrediënten weggelaten: garnalen');
    expect(getRecipe(getDb(), id)).toMatchObject({ veg_per_serving: 100, veg_revision: null });
    expect(row(id).veg_outcome).toBe('failed');
    expect(row(id).veg_note).toMatch(/^niet gelukt: /);
  });

  it('labels a recipe the model calls no dinner, without changing it', async () => {
    const id = recipe('Gemarmerde ringtaart', [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }]);
    const call = vi.fn().mockResolvedValue(JSON.stringify({ course: 'toetje' }));

    expect(await boostRecipe(getDb(), id, call)).toMatchObject({ outcome: 'not_main', note: 'toetje volgens het model' });
    expect(getRecipe(getDb(), id)).toMatchObject({ course: 'toetje', main_course: false, veg_revision: null });
    expect(getDb().prepare('SELECT main_course FROM recipes WHERE id = ?').get(id)).toEqual({ main_course: 0 });
  });

  it('does not ask the model about a recipe that is no dinner or already reaches its norm', async () => {
    const cake = recipe('Ringtaart', [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }], { course: 'toetje' });
    const fine = recipe('Groentecurry', enough);
    const call = vi.fn();

    expect((await boostRecipe(getDb(), cake, call)).outcome).toBe('not_main');
    expect((await boostRecipe(getDb(), fine, call)).outcome).toBe('enough');
    expect(call).not.toHaveBeenCalled();
  });

  it('accepts the minimum for an exception like pizza, and marks it so', async () => {
    const id = recipe('Pizza margherita', [
      { name: 'pizzadeeg', amount: 2, unit: 'stuks', product_group: 'droogwaren' },
      { name: 'passata', amount: 200, unit: 'ml', product_group: 'sauzen' },
      { name: 'mozzarella', amount: 250, unit: 'g', product_group: 'zuivel' },
    ]);
    const withSide = [
      { name: 'pizzadeeg', amount: 2, unit: 'stuks', product_group: 'droogwaren' },
      { name: 'passata', amount: 200, unit: 'ml', product_group: 'sauzen' },
      { name: 'mozzarella', amount: 250, unit: 'g', product_group: 'zuivel' },
      { name: 'snoeptomaatjes', amount: 500, unit: 'g', product_group: 'groenten' },
      { name: 'komkommer', amount: 1, unit: 'stuks', product_group: 'groenten' }, // 400 g
    ];
    const call = vi.fn().mockResolvedValue(answer(withSide, { exception: true }));

    expect(await boostRecipe(getDb(), id, call)).toMatchObject({ outcome: 'boosted', before: 50, after: 275 });
    expect(getRecipe(getDb(), id)).toMatchObject({ veg_exception: true });
  });

  it('tells the model what a dinner lacks besides vegetables, and refuses a proposal that still lacks it', async () => {
    const pesto = [
      { name: 'penne', amount: 400, unit: 'g', product_group: 'droogwaren' },
      { name: 'groene pesto', amount: 100, unit: 'g', product_group: 'sauzen' },
      { name: 'courgette', amount: 400, unit: 'g', product_group: 'groenten' },
    ];
    const id = recipe('Pasta pesto', pesto);
    const greener = [...pesto.slice(0, 2), ...enough.slice(2)];
    const withBeans = [...greener, { name: 'witte bonen uit blik', amount: 400, unit: 'g', product_group: 'droogwaren' }];
    const call = vi.fn().mockResolvedValueOnce(answer(greener)).mockResolvedValueOnce(answer(withBeans));

    expect((await boostRecipe(getDb(), id, call)).outcome).toBe('boosted');
    expect(call.mock.calls[0][1][1].content).toContain('Geschat nu 65 g koolhydraten en 12 g eiwit per portie; als hoofdgerecht mist het eiwit.');
    expect(call.mock.calls[1][1].at(-1).content).toContain('12 g eiwit per persoon, onder de 15 g');
    expect(getRecipe(getDb(), id)).toMatchObject({ veg_per_serving: 350, protein_per_serving: 19, meal_missing: [] });
  });

  it('fills up a dinner that has its vegetables but is no whole meal', async () => {
    const chicken = [{ name: 'kipfilet', amount: 500, unit: 'g', product_group: 'vlees' }, ...enough.slice(2)];
    const id = recipe('Kip met groente uit de oven', chicken);
    expect(getRecipe(getDb(), id)).toMatchObject({ veg_per_serving: 350, meal_missing: ['koolhydraten'] });
    const withPotatoes = [...chicken, { name: 'krieltjes', amount: 800, unit: 'g', product_group: 'groenten' }];
    const call = vi.fn().mockResolvedValue(answer(withPotatoes, { summary: 'Krieltjes erbij.' }));

    expect(await boostRecipe(getDb(), id, call)).toMatchObject({ outcome: 'boosted', before: 350, after: 350, note: 'Krieltjes erbij.' });
    expect(getRecipe(getDb(), id)).toMatchObject({ carbs_per_serving: 30, meal_missing: [], veg_revision: { summary: 'Krieltjes erbij.' } });
  });

  it('gives a side dish its course instead of filling it up', async () => {
    const id = recipe('Groene salade', [{ name: 'gemengde sla', amount: 300, unit: 'g', product_group: 'groenten' }]);
    const call = vi.fn().mockResolvedValue(JSON.stringify({ course: 'bijgerecht' }));

    expect(await boostRecipe(getDb(), id, call)).toMatchObject({ outcome: 'not_main', note: 'bijgerecht volgens het model' });
    expect(getRecipe(getDb(), id)).toMatchObject({ course: 'bijgerecht', meal_missing: [], veg_revision: null });
  });

  it('classifies a recipe whose kind is not known yet, leaving one that does well as it is', async () => {
    const unknown = (name: string) => {
      const id = recipe(name, enough);
      getDb().prepare('UPDATE recipes SET course = NULL, main_course = 0 WHERE id = ?').run(id);
      return id;
    };
    const curry = unknown('Groentecurry');
    const bites = unknown('Groentehapjes');
    const data = getRecipe(getDb(), curry).recipe_data;

    expect(await boostRecipe(getDb(), curry, vi.fn().mockResolvedValue(answer([...enough, { name: 'naan', amount: 4, unit: 'stuks', product_group: 'brood' }]))))
      .toMatchObject({ outcome: 'enough', note: 'hoofdgerecht volgens het model; haalt de norm al' });
    expect(getRecipe(getDb(), curry)).toMatchObject({ course: 'hoofdgerecht', main_course: true, recipe_data: data, veg_revision: null });

    expect((await boostRecipe(getDb(), bites, vi.fn().mockResolvedValue(JSON.stringify({ course: 'snack' })))).outcome).toBe('not_main');
    expect(getRecipe(getDb(), bites)).toMatchObject({ course: 'snack', main_course: false });
  });

  it('keeps that a recipe of unknown kind is a dinner when no proposal passes, but not on answers it could not read', async () => {
    const unknown = (name: string) => {
      const id = recipe(name);
      getDb().prepare('UPDATE recipes SET course = NULL, main_course = 0 WHERE id = ?').run(id);
      return id;
    };
    const short = unknown('Pasta garnalen');
    const unread = unknown('Pasta tonijn');

    // Every proposal still has too little vegetables
    expect((await boostRecipe(getDb(), short, vi.fn().mockResolvedValue(answer(pasta)))).outcome).toBe('failed');
    expect(getRecipe(getDb(), short)).toMatchObject({ course: 'hoofdgerecht', main_course: true, veg_per_serving: 100, veg_revision: null });
    expect(getDb().prepare('SELECT main_course FROM recipes WHERE id = ?').get(short)).toEqual({ main_course: 1 });

    expect((await boostRecipe(getDb(), unread, vi.fn().mockResolvedValue('geen JSON'))).outcome).toBe('failed');
    expect(getRecipe(getDb(), unread)).toMatchObject({ course: null, main_course: false });
  });

  it('stops on a model that is not configured instead of marking the recipe failed', async () => {
    const id = recipe('Pasta garnalen');
    const call = vi.fn().mockRejectedValue(new RecipeError('Taalmodel niet geconfigureerd', 503));
    await expect(boostRecipe(getDb(), id, call)).rejects.toThrow('niet geconfigureerd');
    expect(row(id).veg_outcome).toBeNull();
  });
});

/** A model call that answers only when the test says so, as a slow model would. */
function deferredCall() {
  let answerWith!: (content: string) => void;
  let called!: () => void;
  const started = new Promise<void>((r) => { called = r; });
  const call = vi.fn(() => {
    called();
    return new Promise<string>((r) => { answerWith = r; });
  });
  return { call, started, answer: (content: string) => answerWith(content) };
}

describe('while the model is thinking', () => {
  const manualEdit = (id: number) => updateRecipe(getDb(), parseRecipeInput({
    name: 'Pasta garnalen', servings: 4, status: 'goedgekeurd', meal_type: 'pasta', ingredients: pasta,
    steps: ['Kook de pasta.', 'Handmatig toegevoegd.'],
  }), id);

  it('does not overwrite an edit made meanwhile, and leaves the recipe for the next run', async () => {
    const id = recipe('Pasta garnalen');
    const model = deferredCall();
    const run = boostRecipe(getDb(), id, model.call);
    await model.started;

    manualEdit(id);
    model.answer(answer(enough));

    expect(await run).toMatchObject({ outcome: 'stale', before: 100 });
    const now = getRecipe(getDb(), id);
    expect(JSON.parse(now.recipe_data as string).steps).toEqual(['Kook de pasta.', 'Handmatig toegevoegd.']);
    expect(now).toMatchObject({ veg_per_serving: 100, veg_revision: null });
    expect(row(id)).toMatchObject({ veg_outcome: 'stale', veg_checked_at: null });
    expect(recipesToBoost(getDb())).toContain(id);
  });

  it('does not bring back an old status, e.g. after archiving', async () => {
    const id = recipe('Pasta garnalen');
    const model = deferredCall();
    const run = boostRecipe(getDb(), id, model.call);
    await model.started;

    setRecipeStatus(getDb(), id, 'archief');
    model.answer(answer(enough));

    expect((await run).outcome).toBe('stale');
    expect(getRecipe(getDb(), id)).toMatchObject({ status: 'archief', veg_per_serving: 100 });
  });

  it('does not set "no dinner" over a label changed meanwhile', async () => {
    const id = recipe('Pasta garnalen');
    const model = deferredCall();
    const run = boostRecipe(getDb(), id, model.call);
    await model.started;

    getDb().prepare('UPDATE recipes SET veg_exception = 1 WHERE id = ?').run(id);
    model.answer(JSON.stringify({ course: 'toetje' }));

    expect((await run).outcome).toBe('stale');
    expect(getRecipe(getDb(), id)).toMatchObject({ course: 'hoofdgerecht', main_course: true, veg_exception: true });
  });

  it('does not park a recipe as failed when it was edited during the last attempt', async () => {
    const id = recipe('Pasta garnalen');
    const last = deferredCall();
    // The earlier attempts answer nonsense straight away; the last one is slow
    const call = vi.fn(() => (call.mock.calls.length < BOOST_ATTEMPTS.length ? Promise.resolve('geen JSON') : last.call()));
    const run = boostRecipe(getDb(), id, call);
    await last.started;

    manualEdit(id);
    last.answer('nog steeds geen JSON');

    expect((await run).outcome).toBe('stale');
    expect(row(id)).toMatchObject({ veg_outcome: 'stale', veg_checked_at: null });
  });
});

describe('what counts as dropped', () => {
  const g = (name: string, product_group = 'overig') => ({ name, product_group });

  it('accepts a renamed ingredient that still says what it is', () => {
    expect(droppedIngredients(
      [g('kippendijen (met bot en vel)', 'vlees'), g('rode paprika', 'groenten'), g('tonijn uit blik', 'vis'), g('volkoren spaghetti', 'droogwaren')],
      [g('kippendij'), g('paprika'), g('tonijn in olijfolie'), g('spaghetti')],
    )).toEqual([]);
  });

  it('lets herbs, oil, salt and pepper be split or merged', () => {
    expect(droppedIngredients(
      [g('zout en peper'), g('gedroogde oregano', 'kruiden'), g('olijfolie', 'olie')],
      [g('courgette')],
    )).toEqual([]);
  });

  it('catches a main ingredient that is gone', () => {
    expect(droppedIngredients([g('garnalen', 'vis'), g('courgette', 'groenten')], [g('courgette'), g('spinazie')]))
      .toEqual(['garnalen']);
  });
});

describe('undo', () => {
  it('puts the recipe back as it was, labels included, and keeps it out of the next run', async () => {
    const id = recipe('Pasta garnalen');
    await boostRecipe(getDb(), id, vi.fn().mockResolvedValue(answer(enough, { exception: true })));
    expect(getRecipe(getDb(), id).veg_exception).toBe(true);

    revertVegetables(getDb(), id);
    const back = getRecipe(getDb(), id);
    expect(back).toMatchObject({ veg_per_serving: 100, veg_exception: false, status: 'goedgekeurd', veg_revision: null });
    expect(JSON.parse(back.recipe_data as string).steps).toEqual(['Kook de pasta.']);
    expect(row(id).veg_outcome).toBe('reverted');
    expect(recipesToBoost(getDb())).not.toContain(id);
  });

  it('says so when there is nothing to undo', () => {
    const id = recipe('Pasta garnalen');
    expect(() => revertVegetables(getDb(), id)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('bulk run', () => {
  it('takes dinners below their norm that no run handled yet, approved first', () => {
    const concept = recipe('Concept-pasta', pasta, { status: 'concept' });
    const approved = recipe('Goedgekeurde pasta');
    recipe('Groentecurry', enough);
    recipe('Ringtaart', [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }], { course: 'toetje' });
    recipe('Oud', pasta, { status: 'archief' });
    const handled = recipe('Al gedaan');
    getDb().prepare("UPDATE recipes SET veg_checked_at = '2026-10-01' WHERE id = ?").run(handled);

    expect(recipesToBoost(getDb())).toEqual([approved, concept]);
  });

  it('also takes dinners that are no whole meal and recipes whose kind is not known, not other dishes', () => {
    const noCarbs = recipe('Kip met groente', [{ name: 'kipfilet', amount: 500, unit: 'g', product_group: 'vlees' }, ...enough.slice(2)]);
    const unknown = recipe('Iets', enough);
    getDb().prepare('UPDATE recipes SET course = NULL, main_course = 0 WHERE id = ?').run(unknown);
    recipe('Salade', [{ name: 'gemengde sla', amount: 100, unit: 'g', product_group: 'groenten' }], { course: 'bijgerecht' });
    recipe('Groentecurry', enough);

    expect(recipesToBoost(getDb())).toEqual([noCarbs, unknown]);
  });

  it('works through the list in the background, one run at a time, counting outcomes', async () => {
    const ids = [recipe('A'), recipe('B'), recipe('C')];
    const outcomes = ['boosted', 'failed', 'not_main'] as const;
    const boost = vi.fn(async (_db: unknown, id: number) => ({ outcome: outcomes[ids.indexOf(id)], before: 100, note: '' }));

    const run = startVegetableJob(getDb(), undefined, boost);
    expect(run).toBeInstanceOf(Promise);
    expect(vegetableJob()).toMatchObject({ running: true, total: 3 });
    expect(startVegetableJob(getDb(), undefined, boost)).toBe(false);

    await run;
    expect(vegetableJob()).toMatchObject({
      running: false, done: 3, current: [], error: null,
      counts: { boosted: 1, failed: 1, not_main: 1, enough: 0, stale: 0 },
    });
  });

  it('stops when the model is not configured', async () => {
    const ids = [recipe('A'), recipe('B'), recipe('C'), recipe('D')];
    const boost = vi.fn(async () => { throw new RecipeError('Taalmodel niet geconfigureerd', 503); });
    await startVegetableJob(getDb(), ids, boost);
    expect(vegetableJob().error).toBe('Taalmodel niet geconfigureerd');
    expect(boost.mock.calls.length).toBeLessThanOrEqual(2); // the two workers' first recipes
  });
});
