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
const { isCookedIn, isDryPasta, isSaladVegetable, isWetDish, linesFor } = await import('../server/services/portions');
const { importMenu } = await import('../server/services/menu-generator');
const { createSession, hashPassword } = await import('../server/services/auth');
const { default: app } = await import('../server/index');

type Ingredient = { name: string; amount: number | string | null; unit: string; product_group: string; note?: string | null };

const veg = (name: string, amount: number | string, unit = 'g', note?: string): Ingredient =>
  ({ name, amount, unit, product_group: 'groenten', ...(note ? { note } : {}) });
// The family's own measure of pasta, so only a test about pasta changes it
const spaghetti: Ingredient = { name: 'volkoren spaghetti', amount: 250, unit: 'g', product_group: 'droogwaren' };
const prawns: Ingredient = { name: 'garnalen', amount: 400, unit: 'g', product_group: 'vis' };

function recipe(name: string, ingredients: Ingredient[], extra: Record<string, unknown> = {}) {
  return saveRecipe(getDb(), parseRecipeInput({
    name, servings: 4, status: 'goedgekeurd', meal_type: 'pasta', source: 'Kookboek.md',
    ingredients: [spaghetti, prawns, ...ingredients], steps: ['Kook de pasta.'], ...extra,
  }));
}

/** A recipe as a top-up left it: `now` saved, `was` kept as the revision to go back to. */
function toppedUp(name: string, was: Ingredient[], now: Ingredient[], extra: Record<string, unknown> = {}) {
  // `ingredients` and `steps` are what the top-up made of it; the rest is the recipe itself
  const { ingredients, steps, ...own } = extra as { ingredients?: Ingredient[]; steps?: string[] };
  const id = recipe(name, was, own);
  const original = recipeInputOf(getRecipe(getDb(), id));
  saveRecipe(getDb(), parseRecipeInput({ ...original, ingredients: ingredients ?? [spaghetti, prawns, ...now], steps: steps ?? original.steps }), id);
  getDb().prepare("INSERT INTO recipe_revisions (recipe_id, reason, input, veg_before, veg_after, summary) VALUES (?, 'groente', ?, 100, 500, 'Meer groente.')")
    .run(id, JSON.stringify(original));
  return id;
}

const data = (id: number) => JSON.parse(getRecipe(getDb(), id).recipe_data as string) as { ingredients: Ingredient[]; steps: string[] };
const amounts = (id: number) => Object.fromEntries(data(id).ingredients.map((i) => [i.name, i.amount]));
const perServing = (id: number) => getRecipe(getDb(), id).veg_per_serving;
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

// Han: the recipe as it was written is never too much; it is the top-ups that make a portion too big

describe('the salad a top-up put next to the dish', () => {
  // 400 g of its own, and 2 kg of salad next to it: 600 g a serving
  const was = [veg('courgette', 400)];
  const now = [veg('courgette', 400), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800, 'g', 'toegevoegd, gehalveerd')];

  it('becomes a normal salad, and the recipe keeps what it had', () => {
    const id = toppedUp('Pasta courgette', was, now);
    expect(perServing(id)).toBe(600);

    const plan = trimVegetables(getDb(), id);
    expect(plan).toMatchObject({ outcome: 'trimmed', before: 600, after: 330, summary: 'Minder komkommer en cherrytomaat.' });
    // 200 g of salad a serving, rounded up to what is measured; the courgette was the recipe's own
    expect(amounts(id)).toMatchObject({ courgette: 400, komkommer: 1.5, cherrytomaat: 320, 'volkoren spaghetti': 250, garnalen: 400 });
    expect(perServing(id)).toBe(330);
  });

  it('lets the steps name the new amounts, and drops what the top-up noted on a line', () => {
    const id = toppedUp('Pasta courgette', was, now, { steps: ['Kook de pasta.', 'Halveer 800 g cherrytomaat en snijd de komkommers.', 'Roer 2 el olie erdoor.'] });
    trimVegetables(getDb(), id);
    expect(data(id).steps).toEqual(['Kook de pasta.', 'Halveer 320 g cherrytomaat en snijd de komkommers.', 'Roer 2 el olie erdoor.']);
    // What the note says besides stays
    expect(data(id).ingredients.find((i) => i.name === 'cherrytomaat')!.note).toBe('gehalveerd');
  });

  it('stays as big as it takes to reach the aim, where the dish has no vegetables of its own', () => {
    // A burger with 2 kg of salad: half of it brings the 250 g a serving
    const id = toppedUp('Burger', [], [veg('gemengde sla', 400), veg('tomaat', 800), veg('komkommer', 2, 'stuks')]);
    expect(trimVegetables(getDb(), id)).toMatchObject({ outcome: 'trimmed', before: 500, after: 250 });
    expect(amounts(id)).toMatchObject({ 'gemengde sla': 200, tomaat: 400, komkommer: 1 });
  });

  it('is brought back next to a soup too, whose own vegetables all stay', () => {
    const id = toppedUp('Linzensoep', [veg('wortel', 400)],
      [veg('wortel', 1000), veg('prei', 800), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)], { meal_type: 'soep' });
    trimVegetables(getDb(), id);
    expect(amounts(id)).toMatchObject({ wortel: 1000, prei: 800, komkommer: 1.5, cherrytomaat: 320 });
  });
});

describe('what a top-up cooked into the dish', () => {
  it('stays in a soup and in a sauce, however much', () => {
    const soup = toppedUp('Linzensoep', [veg('wortel', 400)], [veg('wortel', 1000), veg('prei', 800), veg('pompoen', 800)], { meal_type: 'soep' });
    const tin: Ingredient = { name: 'tomatenblokjes uit blik', amount: 400, unit: 'g', product_group: 'sauzen' };
    const sauce = toppedUp('Pasta met tomaat', [tin], [tin, veg('courgette', 800), veg('wortel', 800)]);

    expect(trimVegetables(getDb(), soup)).toMatchObject({ outcome: 'fine', before: 650, after: 650 });
    expect(trimVegetables(getDb(), sauce)).toMatchObject({ outcome: 'fine', before: 500 });
    expect(amounts(sauce)).toMatchObject({ courgette: 800, wortel: 800 });
    expect(revisions(soup)).toEqual(['groente']);
  });

  it('comes back to what a plate carries where there is no soup or sauce', () => {
    // 400 g of its own, topped up to 2400 g: 600 g a serving next to fish
    const id = toppedUp('Garnalen met sperziebonen', [veg('sperziebonen', 400)],
      [veg('sperziebonen', 1000), veg('broccoli', 800), veg('courgette', 600)]);

    expect(trimVegetables(getDb(), id)).toMatchObject({ outcome: 'trimmed', before: 600, after: 400 });
    // Everything added gives up the same part; what the recipe had is in there untouched
    expect(amounts(id)).toMatchObject({ sperziebonen: 760, broccoli: 480, courgette: 360 });
  });

  it('never takes what the recipe had itself, and leaves part of what was added so the steps still fit', () => {
    // 500 g a serving as written, and as much again in salad next to it
    const id = toppedUp('Bloemkool met broccoli', [veg('bloemkool', 1200), veg('broccoli', 800)],
      [veg('bloemkool', 1200), veg('broccoli', 800), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)]);
    trimVegetables(getDb(), id);
    // The dish is over what a plate carries by itself: of the salad a quarter stays, no less
    expect(amounts(id)).toMatchObject({ bloemkool: 1200, broccoli: 800, komkommer: 1, cherrytomaat: 200 });
  });

  it('counts tomatoes that are roasted as part of the dish, not as a salad next to it', () => {
    // 325 g of roasted tomatoes a serving: as a salad next to the dish that would be a mountain
    const now = [veg('courgette', 400), veg('cherrytomaat', 1300)];
    const roasted = toppedUp('Spaghetti met geroosterde tomaat', [veg('courgette', 400)], now,
      { steps: ['Kook de pasta.', 'Halveer de cherrytomaten en rooster ze 15 minuten in de oven.'] });
    expect(trimVegetables(getDb(), roasted)).toMatchObject({ outcome: 'fine' });
    expect(amounts(roasted).cherrytomaat).toBe(1300);

    const raw = toppedUp('Spaghetti met tomatensalade', [veg('courgette', 400)], now,
      { steps: ['Kook de pasta.', 'Halveer de cherrytomaten en meng ze met olie en azijn.'] });
    expect(trimVegetables(getDb(), raw)).toMatchObject({ outcome: 'trimmed' });
    expect(amounts(raw).cherrytomaat).toBe(800);
  });

  it('does not rewrite a recipe for half a carrot', () => {
    // 500 g a serving as written; the top-up only put a cucumber next to it
    const id = toppedUp('Bloemkool met broccoli', [veg('bloemkool', 1200), veg('broccoli', 800)],
      [veg('bloemkool', 1200), veg('broccoli', 800), veg('komkommer', 1, 'stuks')]);
    expect(trimVegetables(getDb(), id)).toMatchObject({ outcome: 'fine', before: 600, after: 600 });
    expect(amounts(id).komkommer).toBe(1);
    expect(revisions(id)).toEqual(['groente']);
  });

  // Kimi review on the first version: a vegetable the top-up gave a name that matches nothing must not count as added
  it('counts a vegetable that got another name as the recipe\'s own', () => {
    // 1200 g of cavolo nero, which the top-up wrote down as boerenkool, with more next to it
    const id = toppedUp('Pasta boerenkool', [veg('cavolo nero', 1200)], [veg('boerenkool', 1200), veg('broccoli', 400), veg('courgette', 400)]);
    trimVegetables(getDb(), id);
    // 300 g a serving was there before, under whichever name: the whole stays above that, at what a plate carries
    expect(perServing(id)).toBe(400);
    expect(Number(amounts(id).boerenkool)).toBeGreaterThanOrEqual(720);
  });

  it('leaves the onion in any spelling, but not a bosui', () => {
    const id = toppedUp('Garnalen met ui', [veg('rode ui (gesnipperd)', 2, 'stuks')],
      [veg('rode ui (gesnipperd)', 2, 'stuks'), veg('ui, in ringen', 3, 'stuks'), veg('bosui', 6, 'stuks'), veg('spinazie', 2000)]);
    trimVegetables(getDb(), id);
    const after = data(id).ingredients;
    expect(after.filter((i) => /^(rode )?ui/.test(i.name)).map((i) => i.amount)).toEqual([2, 3]);
    expect(Number(after.find((i) => i.name === 'bosui')!.amount)).toBeLessThan(6);
  });
});

// Han: "bij pasta hou ik altijd 250 gram voor het gezin aan"
describe('the pasta of a recipe that was topped up', () => {
  const big: Ingredient = { name: 'volkoren spaghetti', amount: 400, unit: 'g', product_group: 'droogwaren' };

  it('goes to what the family cooks, in the steps too', () => {
    const id = toppedUp('Pasta garnalen', [veg('courgette', 400)], [], {
      ingredients: [big, prawns, veg('courgette', 800), veg('spinazie', 400)], steps: ['Kook 400 g spaghetti beetgaar.', 'Bak de courgette.'],
    });
    const plan = trimVegetables(getDb(), id);
    // The vegetables fit the plate: only the pasta gives way
    expect(plan).toMatchObject({ outcome: 'trimmed', before: 300, after: 300, summary: 'Volkoren spaghetti van 400 naar 250 g.' });
    expect(amounts(id)).toMatchObject({ 'volkoren spaghetti': 250, courgette: 800, spinazie: 400 });
    expect(data(id).steps[0]).toBe('Kook 250 g spaghetti beetgaar.');
  });

  it('is told with the vegetables when both change', () => {
    const id = toppedUp('Pasta garnalen', [veg('courgette', 400)], [], {
      ingredients: [big, prawns, veg('courgette', 400), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)],
    });
    expect(trimVegetables(getDb(), id).summary).toBe('Minder komkommer en cherrytomaat; volkoren spaghetti van 400 naar 250 g.');
  });

  it('stays when less would leave the meal short, and the vegetables are still brought back', () => {
    // No fish or meat: the protein of this dinner is its pasta and a little cheese
    const id = saveRecipe(getDb(), parseRecipeInput({
      name: 'Pasta kaas', servings: 4, status: 'goedgekeurd', meal_type: 'pasta', source: 'Kookboek.md', steps: ['Koken.'],
      ingredients: [big, { name: 'parmezaan', amount: 60, unit: 'g', product_group: 'zuivel' }, veg('courgette', 400)],
    }));
    const original = recipeInputOf(getRecipe(getDb(), id));
    saveRecipe(getDb(), parseRecipeInput({ ...original, ingredients: [...original.ingredients, veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)] }), id);
    getDb().prepare("INSERT INTO recipe_revisions (recipe_id, reason, input) VALUES (?, 'groente', ?)").run(id, JSON.stringify(original));
    expect(getRecipe(getDb(), id).meal_missing).toEqual([]);

    expect(trimVegetables(getDb(), id)).toMatchObject({ outcome: 'trimmed', summary: 'Minder komkommer en cherrytomaat.' });
    expect(amounts(id)).toMatchObject({ 'volkoren spaghetti': 400, komkommer: 1.5 });
    expect(getRecipe(getDb(), id).meal_missing).toEqual([]);
  });

  it('is told from what is no dry pasta', () => {
    const line = (name: string, unit = 'g', product_group = 'droogwaren') => linesFor(getDb(), [{ name, amount: 400, unit, product_group }])[0];
    for (const name of ['volkoren penne', 'spaghetti', 'orzo', 'pasta']) expect(isDryPasta(line(name)), name).toBe(true);
    for (const name of ['verse tagliatelle', 'tortellini', 'gnocchi', 'pastasaus', 'mie']) expect(isDryPasta(line(name)), name).toBe(false);
    expect(isDryPasta(line('rode currypasta', 'g', 'sauzen'))).toBe(false);
    expect(isDryPasta(line('lasagne', 'stuks'))).toBe(false);
  });
});

describe('telling a dish and a vegetable for what they are', () => {
  const wet = (name: string, meal_type: string | null, ingredients: Ingredient[] = []) => isWetDish({ name, meal_type }, linesFor(getDb(), ingredients));
  const tin: Ingredient = { name: 'tomatenblokjes uit blik', amount: 400, unit: 'g', product_group: 'sauzen' };

  it('knows a soup, a stew and a sauce, but not a sauce that is only in the name', () => {
    expect(wet('Tomatensoep met linzen', 'soep')).toBe(true);
    expect(wet('Hutspot met rookworst', 'vrij')).toBe(true);
    expect(wet('Kikkererwtencurry', 'rijst')).toBe(true);
    expect(wet('Volkoren pasta bolognese', 'pasta')).toBe(true);
    expect(wet('Pasta met courgette', 'pasta', [tin])).toBe(true);
    expect(wet('Kipspiesjes met satésaus en rijst', 'rijst')).toBe(false);
    expect(wet('Wraps met yoghurt-limoensaus', 'wrap')).toBe(false);
    // The passata on a pizza is no sauce to cook vegetables in
    expect(wet('Plaatpizza met paddenstoelen', 'vrij', [{ name: 'passata', amount: 400, unit: 'g', product_group: 'sauzen' }])).toBe(false);
    expect(wet('Zalm met sperziebonen', 'vrij', [{ name: 'tomatenblokjes uit blik', amount: 100, unit: 'g', product_group: 'sauzen' }])).toBe(false);
  });

  it('knows what goes on the table raw', () => {
    for (const name of ['komkommer', 'cherrytomaat', 'gemengde sla', 'rucola', 'tomaat', 'little gem', 'avocado']) expect(isSaladVegetable(name), name).toBe(true);
    for (const name of ['courgette', 'spinazie', 'tomatenblokjes', 'gepelde tomaten', 'broccoli', 'bosui']) expect(isSaladVegetable(name), name).toBe(false);
  });

  it('reads in the steps whether a tomato or a cabbage goes into the pan', () => {
    expect(isCookedIn('cherrytomaat', ['Halveer de cherrytomaten en voeg ze na 5 minuten bakken mee aan de pan.'])).toBe(true);
    expect(isCookedIn('cherrytomaat', ['Verwarm de oven voor op 200 °C. Halveer de cherrytomaatjes en rooster ze 15 minuten.'])).toBe(true);
    expect(isCookedIn('rode kool', ['Voeg de rode kool in reepjes toe en bak tot de kool zacht is.'])).toBe(true);
    // Cut while something else is in the pan, or mixed into a salad: raw
    expect(isCookedIn('cherrytomaat', ['Bak de vis in de pan. Halveer ondertussen de cherrytomaatjes.', 'Meng de rucola met de cherrytomaatjes.'])).toBe(false);
    expect(isCookedIn('tomaat', ['Serveer de vis uit de pan met een salade van tomaat en ui.'])).toBe(false);
    expect(isCookedIn('witte kool', ['Schaaf de kool fijn en meng met de dressing.'])).toBe(false);
    // Not named at all, or a vegetable that is never cooked: by its name
    expect(isCookedIn('cherrytomaat', ['Kook de pasta.'])).toBe(false);
    expect(isCookedIn('komkommer', ['Bak de komkommer in de pan.'])).toBe(false);
  });
});

describe('what is left alone', () => {
  it('leaves a recipe as it was written, however rich in vegetables or pasta', () => {
    // No top-up: 600 g of vegetables a serving, a salad of 2 kg and 400 g of pasta are the recipe
    const written = saveRecipe(getDb(), parseRecipeInput({
      name: 'Plaatpizza met salade', servings: 4, status: 'goedgekeurd', meal_type: 'vrij', source: 'weekmenu', steps: ['Bakken.'],
      ingredients: [{ name: 'penne', amount: 400, unit: 'g', product_group: 'droogwaren' }, prawns, veg('champignon', 400), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)],
    }));
    expect(trimVegetables(getDb(), written)).toMatchObject({ outcome: 'original' });
    expect(amounts(written)).toMatchObject({ penne: 400, champignon: 400, komkommer: 3, cherrytomaat: 800 });
    expect(revisions(written)).toEqual([]);
  });

  it('leaves a top-up that fits, and what is no dinner', () => {
    const fits = toppedUp('Pasta courgette', [veg('courgette', 400)], [veg('courgette', 800), veg('spinazie', 400), veg('komkommer', 1, 'stuks')]);
    const cake = toppedUp('Courgettetaart', [], [veg('komkommer', 5, 'stuks')], { course: 'toetje' });
    const archived = toppedUp('Oud recept', [], [veg('komkommer', 5, 'stuks')], { status: 'archief' });

    expect(planTrimOf(getDb(), fits)).toMatchObject({ outcome: 'fine', before: 400, after: 400 });
    expect(planTrimOf(getDb(), cake).outcome).toBe('not_dinner');
    expect(planTrimOf(getDb(), archived).outcome).toBe('not_dinner');
    expect(() => planTrimOf(getDb(), 99999)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('once, and the way back', () => {
  const mountain = () => toppedUp('Pasta courgette', [veg('courgette', 400)], [veg('courgette', 400), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)]);

  it('keeps the recipe as it was to go back to, and does not take the same part off twice', () => {
    const id = mountain();
    trimVegetables(getDb(), id);
    expect(getRecipe(getDb(), id).veg_trim).toMatchObject({ veg_before: 600, veg_after: 330, summary: 'Minder komkommer en cherrytomaat.' });
    expect(trimVegetables(getDb(), id).outcome).toBe('done');
    expect(amounts(id)).toMatchObject({ komkommer: 1.5, cherrytomaat: 320 });
  });

  it('puts the recipe back, and leaves it alone in a later run', () => {
    const id = mountain();
    trimVegetables(getDb(), id);
    revertTrim(getDb(), id);
    expect(amounts(id)).toMatchObject({ komkommer: 3, cherrytomaat: 800 });
    expect(getRecipe(getDb(), id).veg_trim).toBeNull();
    expect(trimAllVegetables(getDb()).counts).toMatchObject({ trimmed: 0, done: 1 });
    expect(amounts(id).komkommer).toBe(3);
    expect(() => revertTrim(getDb(), id)).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('goes with the top-up when that is undone', () => {
    const id = mountain();
    trimVegetables(getDb(), id);
    expect(revisions(id)).toEqual(['groente', 'groente-minder']);

    revertVegetables(getDb(), id);
    expect(amounts(id)).toEqual({ 'volkoren spaghetti': 250, garnalen: 400, courgette: 400 });
    expect(revisions(id)).toEqual([]);
    expect(getRecipe(getDb(), id)).toMatchObject({ veg_revision: null, veg_trim: null });
  });
});

describe('the whole library', () => {
  const library = () => ({
    mountain: toppedUp('Pasta courgette', [veg('courgette', 400)], [veg('courgette', 400), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)]),
    fits: toppedUp('Pasta spinazie', [veg('spinazie', 400)], [veg('spinazie', 800), veg('courgette', 400)]),
    written: recipe('Ratatouille uit het boek', [veg('aubergine', 2400)]),
  });

  it('says what it would do without doing it, then does it, shopping lists included', () => {
    const { mountain, written } = library();
    const menu = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: mountain }] }, 47, 2026);
    const onList = () => (getDb().prepare("SELECT quantity FROM shopping_items WHERE menu_id = ? AND item_name = 'cherrytomaat'").get(menu) as { quantity: string }).quantity;
    expect(onList()).toBe('800 g');

    const preview = trimAllVegetables(getDb(), { dryRun: true });
    expect(preview.counts).toEqual({ trimmed: 1, fine: 1, original: 1, done: 0, meal: 0, not_dinner: 0 });
    expect(preview.trimmed).toEqual([{ id: mountain, name: 'Pasta courgette', before: 600, after: 330, summary: 'Minder komkommer en cherrytomaat.' }]);
    expect(amounts(mountain).cherrytomaat).toBe(800);
    expect(revisions(mountain)).toEqual(['groente']);

    expect(trimAllVegetables(getDb()).counts.trimmed).toBe(1);
    expect(amounts(mountain).cherrytomaat).toBe(320);
    expect(amounts(written).aubergine).toBe(2400);
    // The week that is planned buys and cooks the new amounts
    expect(onList()).toBe('320 g');
    const day = getDb().prepare('SELECT recipe_data FROM menu_days WHERE menu_id = ? AND recipe_id = ?').get(menu, mountain) as { recipe_data: string };
    expect(JSON.parse(day.recipe_data).ingredients.find((i: Ingredient) => i.name === 'cherrytomaat').amount).toBe(320);
  });

  it('leaves everything as it was when something fails halfway', () => {
    const { mountain } = library();
    const second = toppedUp('Burger', [], [veg('gemengde sla', 400), veg('tomaat', 800), veg('komkommer', 2, 'stuks')]);
    // Saving the second recipe fails
    getDb().exec(`
      CREATE TRIGGER fail_second BEFORE UPDATE ON recipes WHEN NEW.id = ${second}
      BEGIN SELECT RAISE(ABORT, 'schijf vol'); END;
    `);
    try {
      expect(() => trimAllVegetables(getDb())).toThrow('schijf vol');
    } finally {
      getDb().exec('DROP TRIGGER fail_second');
    }
    expect(amounts(mountain).cherrytomaat).toBe(800);
    expect(revisions(mountain)).toEqual(['groente']);
    expect(trimAllVegetables(getDb()).counts.trimmed).toBe(2);
  });
});

describe('over the API', () => {
  const post = (url: string, body: unknown = {}) => fetch(`${base}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
  });
  const get = async (url: string) => (await fetch(`${base}${url}`, { headers: { Cookie: cookie } })).json();
  const mountain = () => toppedUp('Pasta courgette', [veg('courgette', 400)], [veg('courgette', 400), veg('komkommer', 3, 'stuks'), veg('cherrytomaat', 800)]);

  it('says on a recipe whether its top-up can be brought back, does it, and puts it back', async () => {
    const id = mountain();
    const written = recipe('Ratatouille uit het boek', [veg('aubergine', 2400)]);
    expect(await get(`/api/recipes/${id}`)).toMatchObject({ veg_trimmable: true, veg_trim: null });
    expect((await get(`/api/recipes/${written}`)).veg_trimmable).toBe(false);

    const trimmed = await (await post(`/api/recipes/${id}/vegetables/trim`)).json();
    expect(trimmed).toMatchObject({ outcome: 'trimmed', recipe: { veg_per_serving: 330, veg_trimmable: false, veg_trim: { veg_before: 600, veg_after: 330 } } });
    expect((await (await post(`/api/recipes/${written}/vegetables/trim`)).json()).outcome).toBe('original');

    const back = await (await post(`/api/recipes/${id}/vegetables/trim/revert`)).json();
    // Put back by hand: not offered again
    expect(back).toMatchObject({ veg_per_serving: 600, veg_trim: null, veg_trimmable: false });
    expect((await post(`/api/recipes/${id}/vegetables/trim/revert`)).status).toBe(404);
    expect((await post('/api/recipes/99999/vegetables/trim')).status).toBe(404);
  });

  it('looks the library over in one go, or only says what that would do', async () => {
    mountain();
    expect(await get('/api/vegetables')).toMatchObject({ target: 250, minimum: 175, counts: { dinners: 1, below: 0 } });

    expect((await (await post('/api/vegetables/trim', { dry_run: true })).json()).counts.trimmed).toBe(1);
    expect((await (await post('/api/vegetables/trim', { dry_run: true })).json()).counts.trimmed).toBe(1);
    expect((await (await post('/api/vegetables/trim')).json()).counts.trimmed).toBe(1);
    expect((await (await post('/api/vegetables/trim', { dry_run: true })).json()).counts).toMatchObject({ trimmed: 0, done: 1 });
    expect((await post('/api/vegetables/trim', { dry_run: 'ja' })).status).toBe(400);
  });
});
