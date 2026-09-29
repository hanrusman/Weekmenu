import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-recipes.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb, backfillRecipeLibrary } = await import('../server/db');
const {
  saveRecipe, parseRecipeInput, setRecipeStatus, listRecipes, countRecipesByStatus,
  getRecipe, previewIngredients, RecipeError,
} = await import('../server/services/recipes');
const { setConversion } = await import('../server/services/ingredient-admin');
const { importMenu } = await import('../server/services/menu-generator');

function input(overrides: Record<string, unknown> = {}) {
  return parseRecipeInput({
    name: 'Linzensoep',
    servings: 4,
    meal_type: 'soep',
    prep_time_minutes: 30,
    ingredients: [
      { name: 'Rode linzen', amount: 250, unit: 'g', product_group: 'droogwaren' },
      { name: 'uien', amount: 2, unit: 'stuks', product_group: 'groenten', note: 'gesnipperd' },
      { name: 'zout', amount: null, unit: '', product_group: 'kruiden' },
    ],
    steps: ['Fruit de ui', 'Kook de linzen'],
    ...overrides,
  });
}

function ingredientRows(recipeId: number) {
  return getDb().prepare(`
    SELECT i.name, ri.amount, ri.unit, ri.note, ri.raw_text FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = ? ORDER BY ri.id
  `).all(recipeId);
}

describe('Recipe library', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });

  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    getDb().exec(`
      DELETE FROM menus; DELETE FROM recipes; DELETE FROM recipe_ingredients;
      DELETE FROM ingredient_conversions; DELETE FROM ingredients;
    `);
  });

  describe('saving', () => {
    it('stores a new recipe as concept with normalized ingredient rows and notes', () => {
      const id = saveRecipe(getDb(), input());
      const recipe = getRecipe(getDb(), id) as Record<string, unknown>;
      expect(recipe).toMatchObject({ name: 'Linzensoep', status: 'concept', meal_type: 'soep', prep_time_minutes: 30, source: 'import' });
      expect(JSON.parse(recipe.recipe_data as string).ingredients[1]).toEqual(
        { name: 'uien', amount: 2, unit: 'stuks', product_group: 'groenten', note: 'gesnipperd' },
      );
      expect(ingredientRows(id)).toEqual([
        { name: 'rode linzen', amount: 250, unit: 'g', note: null, raw_text: null },
        { name: 'ui', amount: 2, unit: 'stuks', note: 'gesnipperd', raw_text: null },
        { name: 'zout', amount: null, unit: '', note: null, raw_text: 'naar smaak' },
      ]);
    });

    it('updates name, meta and ingredients of an existing recipe', () => {
      const id = saveRecipe(getDb(), input());
      saveRecipe(getDb(), input({
        name: 'Rode linzensoep', status: 'goedgekeurd', prep_time_minutes: 25,
        ingredients: [{ name: 'rode linzen', amount: 300, unit: 'g', product_group: 'droogwaren' }],
      }), id);
      expect(getRecipe(getDb(), id)).toMatchObject({ name: 'Rode linzensoep', status: 'goedgekeurd', prep_time_minutes: 25 });
      expect(ingredientRows(id)).toEqual([{ name: 'rode linzen', amount: 300, unit: 'g', note: null, raw_text: null }]);
    });

    it('refuses a name that another recipe already has', () => {
      saveRecipe(getDb(), input());
      const other = saveRecipe(getDb(), input({ name: 'Erwtensoep' }));
      expect(() => saveRecipe(getDb(), input(), other)).toThrow(/al een recept/);
      expect(() => saveRecipe(getDb(), input())).toThrow(RecipeError);
    });

    it('rejects input without ingredients or name', () => {
      expect(() => input({ ingredients: [] })).toThrow(/ingrediënt/);
      expect(() => input({ name: '  ' })).toThrow(/Naam/);
    });
  });

  describe('status and listing', () => {
    it('changes status and rejects unknown ones', () => {
      const id = saveRecipe(getDb(), input());
      setRecipeStatus(getDb(), id, 'archief');
      expect(getRecipe(getDb(), id)).toMatchObject({ status: 'archief' });
      expect(() => setRecipeStatus(getDb(), id, 'weg')).toThrow(/Status/);
      expect(() => setRecipeStatus(getDb(), 9999, 'archief')).toThrow(/niet gevonden/);
    });

    it('lists by status with counts and feedback ratings', () => {
      const db = getDb();
      const soep = saveRecipe(db, input({ status: 'goedgekeurd' }));
      saveRecipe(db, input({ name: 'Stamppot' }));
      const menuId = db.prepare("INSERT INTO menus (week_number, year) VALUES (1, 2026)").run().lastInsertRowid;
      for (const rating of ['lekker', 'lekker', 'minder']) {
        const dayId = db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, recipe_id) VALUES (?, 0, 'Dag', 'Linzensoep', '{}', ?)")
          .run(menuId, soep).lastInsertRowid;
        db.prepare('INSERT INTO day_feedback (day_id, rating) VALUES (?, ?)').run(dayId, rating);
      }

      const approved = listRecipes(db, { status: 'goedgekeurd' }) as Array<Record<string, unknown>>;
      expect(approved.map((r) => r.name)).toEqual(['Linzensoep']);
      expect(approved[0]).toMatchObject({ rating_lekker: 2, rating_ok: 0, rating_minder: 1 });
      expect((listRecipes(db, { search: 'stamp' }) as Array<{ name: string }>).map((r) => r.name)).toEqual(['Stamppot']);
      expect(countRecipesByStatus(db)).toEqual({ concept: 1, goedgekeurd: 1, archief: 0 });
    });
  });

  describe('ingredient preview', () => {
    it('tells existing, aliased and new ingredients apart, and whether amounts add up', () => {
      const db = getDb();
      saveRecipe(db, input());
      setConversion(db, (db.prepare("SELECT id FROM ingredients WHERE name = 'rode linzen'").get() as { id: number }).id, 'blik', 400);

      const preview = previewIngredients(db, [
        { name: 'rode linzen', amount: 1, unit: 'blikken' },
        { name: 'Uien', amount: 1, unit: 'stuks' },
        { name: 'ui', amount: 100, unit: 'g' },
        { name: 'pastinaak', amount: 2, unit: '' },
        { name: '', amount: null },
      ]);

      expect(preview.map((p) => [p.canonical, p.match, p.unit, p.adds_up])).toEqual([
        ['rode linzen', 'existing', 'blik', true],
        ['ui', 'alias', 'stuks', true],
        ['ui', 'existing', 'g', false],
        ['pastinaak', 'new', 'stuks', true],
        ['', 'new', '', true],
      ]);
      expect(preview[2].base_unit).toBe('stuks');
    });

    it('suggests an existing ingredient for a new name that looks like it', () => {
      const db = getDb();
      saveRecipe(db, input({ ingredients: [{ name: 'kokosmelk', amount: 1, unit: 'blik', product_group: 'sauzen' }] }));
      const [similar, unrelated] = previewIngredients(db, [
        { name: 'kokosmelk uit blik', amount: 1, unit: 'blik' },
        { name: 'pastinaak', amount: 1, unit: 'stuks' },
      ]);
      expect(similar).toMatchObject({ match: 'new', suggestion: 'kokosmelk' });
      expect(unrelated.suggestion).toBeNull();
    });

    it('rejects something that is not an ingredient list', () => {
      expect(() => previewIngredients(getDb(), 'ui')).toThrow(RecipeError);
    });
  });

  describe('menu import', () => {
    const menu = (ingredientName: string) => ({
      days: [{
        day_name: 'Donderdag', recipe_name: 'Linzensoep', meal_type: 'soep', prep_time_minutes: 40, cost_index: '€',
        recipe: {
          servings: 4,
          ingredients: [{ name: ingredientName, amount: 500, unit: 'g', product_group: 'droogwaren' }],
          steps: ['Koken'],
          nutrition_per_serving: { calories: 400, protein_g: 20, fiber_g: 8, iron_mg: 3 },
        },
      }],
    });

    it('keeps an approved recipe as it is in the library', () => {
      const db = getDb();
      const id = saveRecipe(db, input({ status: 'goedgekeurd' }));
      const before = (getRecipe(db, id) as { recipe_data: string }).recipe_data;

      const menuId = importMenu(menu('gele spliterwten'), 10, 2026);

      expect(getRecipe(db, id)).toMatchObject({ recipe_data: before, times_used: 1 });
      expect(ingredientRows(id).map((r) => (r as { name: string }).name)).toEqual(['rode linzen', 'ui', 'zout']);
      const day = db.prepare('SELECT recipe_id, recipe_data FROM menu_days WHERE menu_id = ?').get(menuId);
      expect(day).toEqual({ recipe_id: id, recipe_data: before });
    });

    it('overwrites a concept and creates new recipes as concept with meta', () => {
      const db = getDb();
      const id = saveRecipe(db, input());
      importMenu(menu('gele spliterwten'), 11, 2026);
      expect(ingredientRows(id).map((r) => (r as { name: string }).name)).toEqual(['gele spliterwten']);
      expect(getRecipe(db, id)).toMatchObject({ status: 'concept', prep_time_minutes: 30 });

      db.exec('DELETE FROM recipes');
      importMenu(menu('gele spliterwten'), 12, 2026);
      expect(listRecipes(db, {})).toEqual([expect.objectContaining({
        name: 'Linzensoep', status: 'concept', meal_type: 'soep', prep_time_minutes: 40, cost_index: '€',
      })]);
    });
  });

  it('backfill copies meta from the last menu day and approves recipes rated lekker', () => {
    const db = getDb();
    const insert = db.prepare("INSERT INTO recipes (name, recipe_data) VALUES (?, '{}')");
    const liked = insert.run('Lekker').lastInsertRowid as number;
    const meh = insert.run('Matig').lastInsertRowid as number;
    const menuId = db.prepare("INSERT INTO menus (week_number, year) VALUES (20, 2026)").run().lastInsertRowid;
    const day = db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, recipe_id, meal_type, prep_time_minutes, cost_index, date) VALUES (?, 0, 'Dag', 'x', '{}', ?, ?, ?, ?, ?)");
    const likedDay = day.run(menuId, liked, 'pasta', 20, '€', '2026-05-01').lastInsertRowid;
    day.run(menuId, liked, 'oven', 45, '€€', '2026-06-01');
    const mehDay = day.run(menuId, meh, 'rijst', 30, '€', '2026-06-02').lastInsertRowid;
    db.prepare("INSERT INTO day_feedback (day_id, rating) VALUES (?, 'lekker'), (?, 'minder')").run(likedDay, mehDay);

    backfillRecipeLibrary(db);

    expect(getRecipe(db, liked)).toMatchObject({ status: 'goedgekeurd', meal_type: 'oven', prep_time_minutes: 45, cost_index: '€€' });
    expect(getRecipe(db, meh)).toMatchObject({ status: 'concept', meal_type: 'rijst' });
  });
});
