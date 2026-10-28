// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-menu-planner.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, parseRecipeInput } = await import('../server/services/recipes');
const { importMenu } = await import('../server/services/menu-generator');
const {
  plannerState, plannerRecipes, startProposal, proposalJob, parseProposalRequest, MENU_ATTEMPTS, MENU_SYSTEM_PROMPT,
} = await import('../server/services/menu-planner');
const { RecipeError } = await import('../server/services/recipes');

type Ingredient = { name: string; amount: number; unit: string; product_group: string };

const veg = (g: number): Ingredient => ({ name: 'courgette', amount: g * 4, unit: 'g', product_group: 'groenten' });
const rice: Ingredient = { name: 'zilvervliesrijst', amount: 300, unit: 'g', product_group: 'droogwaren' };

function recipe(name: string, protein: Ingredient, extra: Record<string, unknown> = {}, vegetables = 360) {
  return saveRecipe(getDb(), parseRecipeInput({
    name, servings: 4, status: 'goedgekeurd', meal_type: 'rijst', prep_time_minutes: 25,
    ingredients: [protein, rice, veg(vegetables)], steps: ['Koken.'], ...extra,
  }));
}

const salmon: Ingredient = { name: 'zalmfilet', amount: 500, unit: 'g', product_group: 'vis' };
const chickpeas: Ingredient = { name: 'kikkererwten', amount: 500, unit: 'g', product_group: 'droogwaren' };
const chicken: Ingredient = { name: 'kipfilet', amount: 500, unit: 'g', product_group: 'vlees' };
const egg: Ingredient = { name: 'ei', amount: 8, unit: 'stuks', product_group: 'zuivel' };

const DAYS = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'];

/** A model answer that puts these ids on the days, in order. */
function answer(ids: number[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    days: ids.map((recipe_id, i) => ({ day_name: DAYS[i], recipe_id })),
    toelichting: 'Twee keer vis en twee keer peulvruchten.', ...extra,
  });
}

const request = (fields: Record<string, unknown> = {}) => parseProposalRequest({
  week_number: 45, year: 2026, days: DAYS.map((day_name) => ({ day_name, recipe_id: null })), ...fields,
});

let ids: Record<string, number>;

beforeAll(() => {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

afterAll(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});

beforeEach(() => {
  getDb().exec('DELETE FROM menus; DELETE FROM recipe_ingredients; DELETE FROM recipes;');
  ids = {
    zalm: recipe('Zalm met rijst', salmon, { meal_type: 'oven' }),
    makreel: recipe('Makreel teriyaki', { ...salmon, name: 'makreel' }, { meal_type: 'rijst' }),
    curry: recipe('Kikkererwtencurry', chickpeas, { meal_type: 'curry' }),
    dahl: recipe('Linzendahl', { ...chickpeas, name: 'rode linzen' }, { meal_type: 'soep' }),
    kip: recipe('Kip teriyaki', chicken, { meal_type: 'wok' }),
    shakshuka: recipe('Shakshuka', egg, { meal_type: 'pan' }),
    wrap: recipe('Wraps met kip', chicken, { meal_type: 'wrap' }),
    dun: recipe('Kip met wat sla', chicken, { meal_type: 'salade' }, 100),
    concept: recipe('Nieuwe stoof', chicken, { status: 'concept', meal_type: 'stoof' }),
  };
});

const good = () => [ids.zalm, ids.curry, ids.kip, ids.dahl, ids.shakshuka, ids.wrap, ids.makreel];

describe('the library for the picker', () => {
  it('gives each dinner the facts the rules need', () => {
    const recipes = plannerRecipes(getDb(), 45, 2026);
    expect(recipes.map((r) => r.name)).toEqual([
      'Kikkererwtencurry', 'Kip met wat sla', 'Kip teriyaki', 'Linzendahl', 'Makreel teriyaki', 'Shakshuka',
      'Wraps met kip', 'Zalm met rijst', 'Nieuwe stoof',
    ]);
    expect(recipes.find((r) => r.id === ids.zalm)).toMatchObject({
      protein: ['vis'], veg_per_serving: 360, veg_exception: false, meal_missing: [], recent_weeks: [],
      ingredients: ['zalmfilet', 'zilvervliesrijst', 'courgette'],
    });
    expect(recipes.find((r) => r.id === ids.curry)?.protein).toEqual(['peulvruchten']);
    expect(recipes.find((r) => r.id === ids.dun)?.veg_per_serving).toBe(100);
  });

  it('marks what was planned in recent weeks, but not in the week being planned', () => {
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.zalm }] }, 44, 2026);
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.curry }] }, 45, 2026);
    const recipes = plannerRecipes(getDb(), 45, 2026);
    expect(recipes.find((r) => r.id === ids.zalm)?.recent_weeks).toEqual([44]);
    expect(recipes.find((r) => r.id === ids.curry)?.recent_weeks).toEqual([]);
  });

  it('only counts the three weeks before the planned one, not menus planned after it', () => {
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.zalm }] }, 44, 2026);
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.dahl }] }, 41, 2026);
    for (const week of [46, 47, 48]) importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.kip }] }, week, 2026);
    const recipes = plannerRecipes(getDb(), 45, 2026);
    expect(recipes.find((r) => r.id === ids.zalm)?.recent_weeks).toEqual([44]);
    expect(recipes.find((r) => r.id === ids.kip)?.recent_weeks).toEqual([]);
    // Four weeks back is no longer recent
    expect(recipes.find((r) => r.id === ids.dahl)?.recent_weeks).toEqual([]);
  });

  it('counts the weeks before the planned one across the year\'s end', () => {
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.zalm }] }, 53, 2026);
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.curry }] }, 51, 2026);
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.kip }] }, 50, 2026);
    const recipes = plannerRecipes(getDb(), 1, 2027);
    expect(recipes.find((r) => r.id === ids.zalm)?.recent_weeks).toEqual([53]);
    expect(recipes.find((r) => r.id === ids.curry)?.recent_weeks).toEqual([51]);
    expect(recipes.find((r) => r.id === ids.kip)?.recent_weeks).toEqual([]);
  });

  it('gives the week with its dates, its neighbours and the menu already there', () => {
    importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.curry }, { day_name: 'Vrijdag', recipe_id: ids.zalm }] }, 45, 2026);
    const state = plannerState(getDb(), 45, 2026);
    expect(state.days[0]).toEqual({ day_name: 'Donderdag', date: '2026-11-05' });
    expect(state.days[6]).toEqual({ day_name: 'Woensdag', date: '2026-11-11' });
    expect(state.previous).toEqual({ week_number: 44, year: 2026 });
    expect(state.existing).toMatchObject({
      days: [{ day_name: 'Donderdag', recipe_id: ids.curry }, { day_name: 'Vrijdag', recipe_id: ids.zalm }],
      saved_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
    });
    expect(Math.abs(Date.parse(state.existing!.saved_at) - Date.now())).toBeLessThan(5000);
    expect(plannerState(getDb(), 53, 2026).next).toEqual({ week_number: 1, year: 2027 });
  });
});

describe('a proposal by the model', () => {
  it('fills the open days with a week that keeps to the rules', async () => {
    const call = vi.fn().mockResolvedValue(answer(good()));
    await startProposal(getDb(), request(), call);

    const job = proposalJob();
    expect(job).toMatchObject({ running: false, error: null, attempt: 1, week_number: 45, year: 2026 });
    expect(job.proposal).toMatchObject({
      fails: [], note: 'Twee keer vis en twee keer peulvruchten.', model: MENU_ATTEMPTS[0].model,
    });
    expect(job.proposal!.days.map((d) => d.recipe_id)).toEqual(good());
    expect(job.proposal!.days[0]).toMatchObject({ day_name: 'Donderdag', date: '2026-11-05' });

    const [model, messages] = call.mock.calls[0];
    expect(model).toBe(MENU_ATTEMPTS[0].model);
    expect(messages[0]).toEqual({ role: 'system', content: MENU_SYSTEM_PROMPT });
    // Only approved recipes, with their facts; the concept is not offered
    expect(messages[1].content).toContain(`#${ids.zalm} Zalm met rijst — oven · 25 min · vis · 360 g groente`);
    expect(messages[1].content).toContain(`#${ids.dun} Kip met wat sla — salade · 25 min · vlees · 100 g groente`);
    expect(messages[1].content).not.toContain('Nieuwe stoof');
  });

  it('hands a week that breaks the rules back with what is wrong, and takes the better one', async () => {
    const bad = [ids.zalm, ids.curry, ids.kip, ids.dahl, ids.dun, ids.wrap, ids.shakshuka];
    const call = vi.fn().mockResolvedValueOnce(answer(bad)).mockResolvedValueOnce(answer(good()));
    await startProposal(getDb(), request(), call);

    expect(call).toHaveBeenCalledTimes(2);
    const retry = call.mock.calls[1][1];
    expect(retry[2]).toEqual({ role: 'assistant', content: answer(bad) });
    expect(retry[3].content).toBe([
      'De app keurde dit menu af, omdat het niet aan de kaders voldoet:',
      '- Maandag: 100 g groente (doel 350 g)',
      '',
      'Liever ook anders, als het kan:',
      '- Vis: 1× (minstens 2)',
      '- Vlees: 3× (hooguit 3, liever 2)',
      '',
      'Pas het menu aan en geef het hele JSON-object opnieuw.',
    ].join('\n'));
    expect(proposalJob().proposal).toMatchObject({ fails: [] });
    expect(proposalJob().proposal!.days.map((d) => d.recipe_id)).toEqual(good());
  });

  it('gives the best week with what is still off when no attempt keeps to every rule', async () => {
    const bad = [ids.zalm, ids.curry, ids.kip, ids.dahl, ids.dun, ids.wrap, ids.shakshuka];
    const worse = [ids.dun, ids.dun, ids.kip, ids.dahl, ids.dun, ids.wrap, ids.shakshuka];
    const call = vi.fn().mockResolvedValueOnce(answer(bad)).mockResolvedValueOnce(answer(worse)).mockResolvedValueOnce('geen idee');
    await startProposal(getDb(), request(), call);

    expect(call).toHaveBeenCalledTimes(MENU_ATTEMPTS.length);
    expect(call.mock.calls[2][0]).toBe(MENU_ATTEMPTS[2].model);
    const { proposal, error } = proposalJob();
    expect(error).toBeNull();
    expect(proposal!.days.map((d) => d.recipe_id)).toEqual(bad);
    expect(proposal!.fails).toEqual(['Maandag: 100 g groente (doel 350 g)']);
    expect(proposal!.warnings).toEqual(['Vis: 1× (minstens 2)', 'Vlees: 3× (hooguit 3, liever 2)']);
  });

  it('keeps the chosen and free days, and only takes recipes from the list', async () => {
    const days = DAYS.map((day_name) => ({ day_name, recipe_id: null as number | null, free: false }));
    days[0].recipe_id = ids.concept;
    days[3].free = true;
    // The model tries to change Thursday, plans the free day, and picks a concept on Friday
    const reply = answer([ids.zalm, ids.concept, ids.kip, ids.dahl, ids.shakshuka, ids.wrap, ids.makreel]);
    const call = vi.fn().mockResolvedValue(reply);
    await startProposal(getDb(), request({ days }), call);

    const { proposal } = proposalJob();
    expect(proposal!.days.map((d) => d.recipe_id)).toEqual([ids.concept, null, ids.kip, null, ids.shakshuka, ids.wrap, ids.makreel]);
    expect(proposal!.days[3].free).toBe(true);
    expect(proposal!.fails[0]).toBe(`Vrijdag: #${ids.concept} staat niet in de lijst`);
    const prompt = call.mock.calls[0][1][1].content as string;
    expect(prompt).toContain('Kies een recept voor: Vrijdag 6 november (doordeweeks), Zaterdag 7 november (weekend), Maandag');
    expect(prompt).toContain(`- Donderdag: #${ids.concept} Nieuwe stoof`);
    expect(prompt).toContain('Geen avondeten nodig op: Zondag.');
  });

  it('tells the model when its answer is no menu, and moves on when a call fails', async () => {
    const call = vi.fn()
      .mockRejectedValueOnce(new Error('cloud-glm gaf geen antwoord'))
      .mockResolvedValueOnce('Hier is je menu!')
      .mockResolvedValueOnce(answer(good()));
    await startProposal(getDb(), request(), call);

    expect(call.mock.calls[2][1].slice(2)).toEqual([
      { role: 'assistant', content: 'Hier is je menu!' },
      { role: 'user', content: 'Dat kon de app niet gebruiken: het antwoord was geen geldig JSON-object. Antwoord met alleen het JSON-object.' },
    ]);
    expect(proposalJob().proposal?.fails).toEqual([]);
  });

  it('reports an error when no attempt gives a menu at all', async () => {
    await startProposal(getDb(), request(), vi.fn().mockResolvedValue('nee'));
    expect(proposalJob()).toMatchObject({
      running: false, proposal: null,
      error: 'Het taalmodel gaf geen bruikbaar menu (het antwoord was geen geldig JSON-object)',
    });
  });

  it('stops at once when the model cannot be reached', async () => {
    const call = vi.fn().mockRejectedValue(new RecipeError('Taalmodel niet bereikbaar (ECONNREFUSED)', 503));
    await startProposal(getDb(), request(), call);
    expect(call).toHaveBeenCalledTimes(1);
    expect(proposalJob().error).toBe('Taalmodel niet bereikbaar (ECONNREFUSED)');
  });

  it('runs one proposal at a time', async () => {
    let finish!: (value: string) => void;
    const call = vi.fn().mockReturnValue(new Promise<string>((resolve) => { finish = resolve; }));
    const run = startProposal(getDb(), request(), call);
    expect(proposalJob()).toMatchObject({ running: true, attempt: 1 });
    expect(startProposal(getDb(), request(), call)).toBe(false);
    finish(answer(good()));
    await run;
    expect(proposalJob().running).toBe(false);
  });

  it('picks breakfasts and snacks from the library when none are chosen yet', async () => {
    const oats = saveRecipe(getDb(), parseRecipeInput({
      name: 'Overnight oats', status: 'goedgekeurd', course: 'ontbijt',
      ingredients: [{ name: 'havermout', amount: 200, unit: 'g', product_group: 'droogwaren' }],
    }));
    const call = vi.fn().mockResolvedValue(answer(good(), { breakfasts: [oats, 9999, { recipe_id: oats }], snacks: [ids.zalm] }));
    await startProposal(getDb(), request(), call);
    expect(proposalJob().proposal).toMatchObject({ breakfasts: [oats], snacks: [] });
    expect(call.mock.calls[0][1][1].content).toContain(`## Ontbijt (kies er 2)\n\n#${oats} Overnight oats`);
  });
});

describe('a week saved from the picker', () => {
  it('dates the days from the week\'s start, also when its first days are free', () => {
    const menuId = importMenu({ start_day: 'Donderdag', days: [{ day_name: 'Maandag', recipe_id: ids.zalm }] }, 45, 2026);
    expect(getDb().prepare('SELECT date FROM menu_days WHERE menu_id = ?').get(menuId)).toEqual({ date: '2026-11-09' });
    expect(() => importMenu({ start_day: 'Maandagavond', days: [{ day_name: 'Maandag', recipe_id: ids.zalm }] }, 45, 2026))
      .toThrow(/onbekende dag/);
  });
});

describe('a smaller portion on a day', () => {
  it('buys for the persons of that day, and gives the day its recipe for them', async () => {
    const { dayRecipeData } = await import('../server/services/servings');
    const menuId = importMenu({ start_day: 'Donderdag', days: [
      { day_name: 'Donderdag', recipe_id: ids.zalm, servings: 2 },
      { day_name: 'Vrijdag', recipe_id: ids.curry },
    ] }, 45, 2026);
    const shopping = getDb().prepare('SELECT item_name, quantity FROM shopping_items WHERE menu_id = ?').all(menuId) as
      Array<{ item_name: string; quantity: string }>;
    expect(shopping.find((i) => i.item_name === 'zalmfilet')?.quantity).toBe('250 g');
    expect(shopping.find((i) => i.item_name === 'kikkererwten')?.quantity).toBe('500 g');

    const day = getDb().prepare("SELECT recipe_data, servings FROM menu_days WHERE menu_id = ? AND day_name = 'Donderdag'")
      .get(menuId) as { recipe_data: string; servings: number };
    expect(day.servings).toBe(2);
    const cooked = JSON.parse(dayRecipeData(day.recipe_data, day.servings));
    expect(cooked.servings).toBe(2);
    expect(cooked.ingredients.find((i: { name: string }) => i.name === 'zalmfilet').amount).toBe(250);
    // The household's day is left as it is
    expect(dayRecipeData(day.recipe_data, null)).toBe(day.recipe_data);

    expect(plannerState(getDb(), 45, 2026).existing?.days).toEqual([
      { day_name: 'Donderdag', recipe_id: ids.zalm, servings: 2 },
      { day_name: 'Vrijdag', recipe_id: ids.curry, servings: null },
    ]);
  });

  it('refuses a portion that is no number of persons', () => {
    expect(() => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: ids.zalm, servings: 0 }] }, 45, 2026)).toThrow();
  });
});

describe('the request from the picker', () => {
  it('needs an open day and known day names', () => {
    expect(() => request({ days: [{ day_name: 'Donderdag', recipe_id: 1 }] })).toThrow('Alle dagen zijn al gekozen');
    expect(() => request({ days: [{ day_name: 'Maandagavond', recipe_id: null }] })).toThrow(/days\.0\.day_name/);
  });
});
