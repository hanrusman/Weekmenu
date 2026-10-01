import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-menu-library.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, parseRecipeInput, getRecipe } = await import('../server/services/recipes');
const { importMenu, MenuImportError } = await import('../server/services/menu-generator');
const { buildPlanningBrief, proteinOf } = await import('../server/services/planning');

function recipe(name: string, overrides: Record<string, unknown> = {}) {
  return saveRecipe(getDb(), parseRecipeInput({
    name,
    status: 'goedgekeurd',
    meal_type: 'soep',
    prep_time_minutes: 30,
    cost_index: '€',
    ingredients: [{ name: 'rode linzen', amount: 250, unit: 'g', product_group: 'droogwaren' }],
    steps: ['Koken'],
    ...overrides,
  }));
}

const newRecipeDay = {
  day_name: 'Vrijdag', recipe_name: 'Pasta pesto', meal_type: 'pasta', prep_time_minutes: 20, cost_index: '€',
  recipe: {
    servings: 4,
    ingredients: [{ name: 'pasta', amount: 400, unit: 'g', product_group: 'droogwaren' }],
    steps: ['Koken'],
    nutrition_per_serving: { calories: 450, protein_g: 18, fiber_g: 6, iron_mg: 2.5 },
  },
};

function days(menuId: number) {
  return getDb().prepare(`
    SELECT day_name, recipe_id, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index
    FROM menu_days WHERE menu_id = ? ORDER BY day_of_week
  `).all(menuId) as Array<Record<string, unknown>>;
}

describe('Menus planned from the library', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    getDb().exec('DELETE FROM menus; DELETE FROM recipes; DELETE FROM recipe_ingredients; DELETE FROM ingredients;');
  });

  describe('import with recipe_id', () => {
    it('plans a library recipe by id, taking recipe, name and meta from the library', () => {
      const id = recipe('Linzensoep', { prep_time_minutes: 25, cost_index: '€€' });
      const library = getRecipe(getDb(), id) as { recipe_data: string };

      const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id, recipe_name: 'linzensoep' }] }, 10, 2026);

      expect(days(menuId)).toEqual([{
        day_name: 'Donderdag', recipe_id: id, recipe_name: 'Linzensoep', recipe_data: library.recipe_data,
        meal_type: 'soep', prep_time_minutes: 25, cost_index: '€€',
      }]);
      expect(getRecipe(getDb(), id)).toMatchObject({ times_used: 1 });
      const shopping = getDb().prepare('SELECT item_name, quantity FROM shopping_items WHERE menu_id = ?').all(menuId);
      expect(shopping).toEqual([{ item_name: 'rode linzen', quantity: '250 g' }]);
    });

    it('mixes library days with a new recipe, which joins the library as concept', () => {
      const id = recipe('Linzensoep');
      const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }, newRecipeDay] }, 11, 2026);

      expect(days(menuId).map((d) => d.recipe_name)).toEqual(['Linzensoep', 'Pasta pesto']);
      const created = getDb().prepare("SELECT status, meal_type FROM recipes WHERE name = 'Pasta pesto'").get();
      expect(created).toEqual({ status: 'concept', meal_type: 'pasta' });
    });

    it('accepts a concept recipe by id', () => {
      const id = recipe('Erwtensoep', { status: 'concept' });
      const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }] }, 12, 2026);
      expect(days(menuId)[0]).toMatchObject({ recipe_id: id, recipe_name: 'Erwtensoep' });
    });

    it('accepts a name that differs only in case, accents, punctuation or spacing', () => {
      const id = recipe('Crème brûlée-achtige rijstpap');
      expect(() => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id, recipe_name: 'creme brulee achtige  rijstpap!' }] }, 13, 2026)).not.toThrow();
    });

    it('refuses a name that is only part of the recipe name, longer, or empty after cleaning', () => {
      const id = recipe('Pasta pesto met kip');
      for (const name of ['Pasta pesto', 'Pasta pesto met kip en rucola', '!!!']) {
        expect(() => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id, recipe_name: name }] }, 14, 2026))
          .toThrow(/heet "Pasta pesto met kip"/);
      }
      expect(() => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id, recipe_name: '  ' }] }, 14, 2026)).toThrow();
      expect(getDb().prepare('SELECT COUNT(*) AS c FROM menus WHERE week_number = 14').get()).toEqual({ c: 0 });
    });

    it('never treats a day with an invalid recipe_id as a new recipe', () => {
      for (const recipeId of ['1', null, 0, 1.5, -3]) {
        expect(() => importMenu({ days: [{ ...newRecipeDay, recipe_id: recipeId }] }, 17, 2026)).toThrow(/recipe_id/);
      }
      expect(getDb().prepare("SELECT COUNT(*) AS c FROM recipes WHERE name = 'Pasta pesto'").get()).toEqual({ c: 0 });
      expect(getDb().prepare('SELECT COUNT(*) AS c FROM menus WHERE week_number = 17').get()).toEqual({ c: 0 });
    });

    it('refuses an unknown id, an archived recipe, and a name that belongs to another recipe', () => {
      const soep = recipe('Linzensoep');
      const oud = recipe('Oude stamppot', { status: 'archief' });

      expect(() => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: 9999 }] }, 15, 2026))
        .toThrow(/Donderdag: recept #9999 staat niet in de bibliotheek/);
      expect(() => importMenu({ days: [{ day_name: 'Vrijdag', recipe_id: oud }] }, 15, 2026))
        .toThrow(/gearchiveerd/);
      expect(() => importMenu({ days: [{ day_name: 'Zaterdag', recipe_id: soep, recipe_name: 'Zalm met krieltjes' }] }, 15, 2026))
        .toThrow(MenuImportError);
      expect(() => importMenu({ days: [{ day_name: 'Zaterdag', recipe_id: soep, recipe_name: 'Zalm met krieltjes' }] }, 15, 2026))
        .toThrow(/heet "Linzensoep", niet "Zalm met krieltjes"/);
    });

    it('leaves the existing menu for the week untouched when an import is refused', () => {
      const id = recipe('Linzensoep');
      const first = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: id }] }, 16, 2026);

      expect(() => importMenu({ days: [{ day_name: 'Donderdag', recipe_id: 9999 }] }, 16, 2026)).toThrow();

      expect(getDb().prepare('SELECT id FROM menus WHERE week_number = 16').all()).toEqual([{ id: first }]);
      expect(days(first)).toHaveLength(1);
      expect(getRecipe(getDb(), id)).toMatchObject({ times_used: 1 });
    });
  });

  describe('planning brief', () => {
    it('leaves out what is not a dinner, marks exceptions and states the vegetable aim', () => {
      const db = getDb();
      recipe('Pizza margherita', { meal_type: 'oven', veg_exception: true, ingredients: [
        { name: 'pizzadeeg', amount: 1, unit: 'stuks', product_group: 'droogwaren' },
        { name: 'snoeptomaatjes', amount: 400, unit: 'g', product_group: 'groenten' },
      ] });
      recipe('Gemarmerde ringtaart', { course: 'toetje' });

      const { text, recipe_count } = buildPlanningBrief(db, new Date('2026-09-30T12:00:00Z'));
      expect(recipe_count).toBe(1);
      expect(text).toMatch(/#\d+ Pizza margherita — oven · 30 min · € · vega · 100 g groente \(uitzondering\)/);
      expect(text).not.toContain('ringtaart');
      expect(text).toContain('350 g groente per volwassene');
      expect(text).toContain('hooguit één keer per week');
    });

    it('says what a dinner lacks to be a whole meal, and offers the approved snacks', () => {
      const db = getDb();
      const salad = recipe('Groene salade met ei', { meal_type: 'salade', ingredients: [
        { name: 'gemengde sla', amount: 200, unit: 'g', product_group: 'groenten' },
        { name: 'ei', amount: 4, unit: 'stuks', product_group: 'zuivel' },
      ] });
      recipe('Wraps met kip', { meal_type: 'wrap', ingredients: [
        { name: 'volkoren wraps', amount: 8, unit: 'stuks', product_group: 'brood' },
        { name: 'kipfilet', amount: 400, unit: 'g', product_group: 'vlees' },
      ] });
      recipe('Dadelballetjes', { course: 'snack' });
      recipe('Concept-hapje', { course: 'snack', status: 'concept' });
      recipe('Tosti', { course: 'lunch' });

      const { text, recipe_count } = buildPlanningBrief(db, new Date('2026-09-30T12:00:00Z'));
      expect(recipe_count).toBe(2);
      expect(text).toContain(`#${salad} Groene salade met ei — salade · 30 min · € · vega · 50 g groente · mist koolhydraten en eiwit`);
      expect(text).toMatch(/Wraps met kip — wrap · 30 min · € · vlees · 0 g groente(\n| ·(?! mist))/);
      expect(text).toContain('"mist koolhydraten" of "mist eiwit" is zo geen hele maaltijd');
      expect(text).toContain('## Snacks uit de bibliotheek');
      expect(text).toContain('- Dadelballetjes');
      expect(text).not.toContain('Concept-hapje');
      expect(text).not.toContain('Tosti');
    });

    it('lists approved recipes with meta, protein, ratings and main ingredients', () => {
      const db = getDb();
      const soep = recipe('Linzensoep', {
        ingredients: [
          { name: 'rode linzen', amount: 250, unit: 'g', product_group: 'droogwaren' },
          { name: 'ui', amount: 1, unit: 'stuks', product_group: 'groenten' },
          { name: 'komijn', amount: 1, unit: 'tl', product_group: 'kruiden' },
        ],
      });
      recipe('Zalm uit de oven', { meal_type: 'oven', prep_time_minutes: 35, cost_index: '€€', ingredients: [{ name: 'zalmfilet', amount: 500, unit: 'g', product_group: 'vis' }] });
      recipe('Pasta pesto', { status: 'concept', meal_type: 'pasta' });

      const menuId = importMenu({ days: [{ day_name: 'Donderdag', recipe_id: soep }] }, 20, 2026);
      const dayId = (db.prepare('SELECT id FROM menu_days WHERE menu_id = ?').get(menuId) as { id: number }).id;
      db.prepare("INSERT INTO day_feedback (day_id, rating, notes) VALUES (?, 'lekker', 'Kinderen wilden meer')").run(dayId);

      const { text, recipe_count } = buildPlanningBrief(db, new Date('2026-09-30T12:00:00Z'));

      expect(recipe_count).toBe(2);
      expect(text).toContain('# Weekmenu-bibliotheek (2026-09-30)');
      // 1 ui of 100 g for 4 people; lentils are pulses, not vegetables
      expect(text).toMatch(new RegExp(`#${soep} Linzensoep — soep · 30 min · € · peulvruchten · 25 g groente · beoordeeld 1× lekker · laatst gepland \\d{4}-\\d{2}-\\d{2}`));
      expect(text).toContain('   rode linzen, ui\n');
      expect(text).toMatch(/#\d+ Zalm uit de oven — oven · 35 min · €€ · vis/);
      expect(text).not.toContain('Pasta pesto —');
      expect(text).toContain('## Recent gepland');
      expect(text).toContain('- Donderdag: Linzensoep');
      expect(text).toContain('- Linzensoep (lekker): "Kinderen wilden meer"');
      expect(text).toContain('"recipe_id": 12');
    });

    it('tells fish, meat and pulses apart by name as well as product group', () => {
      const tag = (...items: Array<[string, string]>) => proteinOf(items.map(([name, product_group]) => ({ name, product_group })));
      expect(tag(['diepvries garnalen', 'diepvries'], ['volkoren mie', 'droogwaren'])).toBe('vis');
      expect(tag(['zalmfilet', 'vis'], ['sperziebonen', 'groenten'], ['doperwten', 'groenten'])).toBe('vis');
      expect(tag(['gerookte kipreepjes', 'overig'], ['kruimige aardappelen', 'groenten'])).toBe('vlees');
      expect(tag(['kippenbouillon', 'overig'], ['pompoen', 'groenten'])).toBe('vega');
      expect(tag(['volkoren hamburgerbroodjes', 'brood'], ['champignon', 'groenten'])).toBe('vega');
      expect(tag(['kikkererwten uit blik', 'droogwaren'], ['ei', 'zuivel'])).toBe('peulvruchten');
      expect(tag(['zwarte bonen uit blik', 'droogwaren'], ['rundergehakt', 'vlees'])).toBe('vlees + peulvruchten');
      expect(tag(['falafel', 'overig'], ['hummus', 'sauzen'])).toBe('peulvruchten');
      // Vegetarian substitutes are not meat or fish; singular bean names count as pulses
      expect(tag(['vegetarisch gehakt', 'overig'], ['pasta', 'droogwaren'])).toBe('vega');
      expect(tag(['vegetarische kipstukjes', 'overig'])).toBe('vega');
      expect(tag(['vegan zalm', 'vis'])).toBe('vega');
      expect(tag(['plantaardige burger', 'vlees'])).toBe('vega');
      expect(tag(['witte boon', 'overig'])).toBe('peulvruchten');
      expect(tag(['bruine boon uit blik', 'overig'])).toBe('peulvruchten');
      expect(tag(['sojaboon', 'diepvries'])).toBe('peulvruchten');
      // A substitute next to real meat still makes the dish a meat dish
      expect(tag(['vegetarische kipstukjes', 'overig'], ['spekjes', 'vlees'])).toBe('vlees');
    });

    it('says so when nothing is approved yet', () => {
      const { text, recipe_count } = buildPlanningBrief(getDb());
      expect(recipe_count).toBe(0);
      expect(text).toContain('Nog geen goedgekeurde recepten');
    });
  });
});
