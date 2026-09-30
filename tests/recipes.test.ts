import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-recipes.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb, backfillRecipeLibrary, dedupeRecipeNames } = await import('../server/db');
const {
  saveRecipe, updateRecipe, parseRecipeInput, setRecipeStatus, listRecipes, countRecipesByStatus,
  getRecipe, previewIngredients, RecipeError,
} = await import('../server/services/recipes');
const { generateShoppingList } = await import('../server/services/shopping-generator');
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

    it('refuses a name that another recipe already has, regardless of case', () => {
      saveRecipe(getDb(), input());
      const other = saveRecipe(getDb(), input({ name: 'Erwtensoep' }));
      expect(() => saveRecipe(getDb(), input(), other)).toThrow(/al een recept/);
      expect(() => saveRecipe(getDb(), input())).toThrow(RecipeError);
      expect(() => saveRecipe(getDb(), input({ name: ' LINZENSOEP ' }))).toThrow(/al een recept "Linzensoep"/);
      // Renaming a recipe to a different case of its own name is fine
      expect(() => saveRecipe(getDb(), input({ name: 'erwtensoep' }), other)).not.toThrow();
    });

    it('keeps the menu day and the shopping list in step when a recipe is edited', () => {
      const db = getDb();
      const id = saveRecipe(db, input({ ingredients: [{ name: 'rode linzen', amount: 250, unit: 'g', product_group: 'droogwaren' }] }));
      const menuId = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (30, 2026, 'active')").run().lastInsertRowid as number;
      const addDay = db.prepare(`
        INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index, recipe_id, status)
        SELECT ?, ?, ?, name, recipe_data, meal_type, prep_time_minutes, cost_index, id, ? FROM recipes WHERE id = ?
      `);
      const upcoming = addDay.run(menuId, 0, 'Donderdag', 'approved', id).lastInsertRowid;
      const eaten = addDay.run(menuId, 1, 'Maandag', 'completed', id).lastInsertRowid;
      generateShoppingList(menuId);

      updateRecipe(db, input({
        name: 'Rode linzensoep', prep_time_minutes: 25, cost_index: '€€',
        ingredients: [{ name: 'rode linzen', amount: 300, unit: 'g', product_group: 'droogwaren' }],
      }), id);

      const shopping = db.prepare('SELECT item_name, quantity FROM shopping_items WHERE menu_id = ?').all(menuId);
      expect(shopping).toEqual([{ item_name: 'rode linzen', quantity: '300 g' }]);

      const day = (dayId: unknown) => db.prepare('SELECT recipe_name, recipe_data, prep_time_minutes, cost_index FROM menu_days WHERE id = ?')
        .get(dayId) as { recipe_name: string; recipe_data: string; prep_time_minutes: number; cost_index: string };
      expect(day(upcoming)).toMatchObject({ recipe_name: 'Rode linzensoep', prep_time_minutes: 25, cost_index: '€€' });
      expect(JSON.parse(day(upcoming).recipe_data).ingredients).toEqual([
        { name: 'rode linzen', amount: 300, unit: 'g', product_group: 'droogwaren' },
      ]);
      // A day already eaten keeps the version that was cooked
      expect(day(eaten)).toMatchObject({ recipe_name: 'Linzensoep', prep_time_minutes: 30 });
      expect(JSON.parse(day(eaten).recipe_data).ingredients[0].amount).toBe(250);
    });

    it('clears meta on upcoming menu days when it is cleared in the library', () => {
      const db = getDb();
      const id = saveRecipe(db, input({ meal_type: 'soep', prep_time_minutes: 30, cost_index: '€' }));
      const menuId = db.prepare("INSERT INTO menus (week_number, year, status) VALUES (31, 2026, 'active')").run().lastInsertRowid;
      const dayId = db.prepare(`
        INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index, recipe_id, status)
        SELECT ?, 0, 'Donderdag', name, recipe_data, meal_type, prep_time_minutes, cost_index, id, 'approved' FROM recipes WHERE id = ?
      `).run(menuId, id).lastInsertRowid;

      updateRecipe(db, input({ meal_type: null, prep_time_minutes: null, cost_index: null }), id);

      expect(getRecipe(db, id)).toMatchObject({ meal_type: null, prep_time_minutes: null, cost_index: null });
      expect(db.prepare('SELECT meal_type, prep_time_minutes, cost_index FROM menu_days WHERE id = ?').get(dayId))
        .toEqual({ meal_type: null, prep_time_minutes: null, cost_index: null });
    });

    it('cuts a long source name instead of refusing the recipe', () => {
      const id = saveRecipe(getDb(), input({ source: `  ${'Een heel lang bestand met recepten van Claude '.repeat(3)}.json` }));
      const { source } = getRecipe(getDb(), id) as { source: string };
      expect(source).toHaveLength(50);
      expect(source.startsWith('Een heel lang bestand')).toBe(true);
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

    it('recognises a known ingredient written with or without a space or hyphen', () => {
      const db = getDb();
      saveRecipe(db, input({ ingredients: [{ name: 'cannellinibonen uit blik', amount: 1, unit: 'blik', product_group: 'droogwaren' }] }));
      expect(previewIngredients(db, [{ name: 'cannellini bonen uit blik', amount: 1, unit: 'blik' }])[0])
        .toMatchObject({ canonical: 'cannellinibonen uit blik', match: 'alias', ingredient_id: expect.any(Number) });
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

    it('keeps an approved recipe, including its meta, as it is in the library', () => {
      const db = getDb();
      // Library: stamppot, 25 min, €€ -- the import says soep, 40 min, €
      const id = saveRecipe(db, input({ status: 'goedgekeurd', meal_type: 'stamppot', prep_time_minutes: 25, cost_index: '€€' }));
      const before = (getRecipe(db, id) as { recipe_data: string }).recipe_data;

      const menuId = importMenu(menu('gele spliterwten'), 10, 2026);

      expect(getRecipe(db, id)).toMatchObject({
        recipe_data: before, times_used: 1, meal_type: 'stamppot', prep_time_minutes: 25, cost_index: '€€',
      });
      expect(ingredientRows(id).map((r) => (r as { name: string }).name)).toEqual(['rode linzen', 'ui', 'zout']);
      const day = db.prepare('SELECT recipe_id, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index FROM menu_days WHERE menu_id = ?').get(menuId);
      expect(day).toEqual({
        recipe_id: id, recipe_name: 'Linzensoep', recipe_data: before,
        meal_type: 'stamppot', prep_time_minutes: 25, cost_index: '€€',
      });
    });

    it('recognises a recipe regardless of case and surrounding spaces', () => {
      const db = getDb();
      const approved = saveRecipe(db, input({ status: 'goedgekeurd' }));
      const concept = saveRecipe(db, input({ name: 'Erwtensoep' }));
      const renamed = (name: string) => {
        const m = menu('gele spliterwten');
        m.days[0].recipe_name = name;
        return m;
      };

      const first = importMenu(renamed('  linzensoep '), 13, 2026);
      importMenu(renamed('ERWTENSOEP'), 14, 2026);

      expect(listRecipes(db, {}).map((r) => (r as { id: number }).id).sort()).toEqual([approved, concept].sort());
      expect(db.prepare('SELECT recipe_id, recipe_name FROM menu_days WHERE menu_id = ?').get(first))
        .toEqual({ recipe_id: approved, recipe_name: 'Linzensoep' });
      expect(ingredientRows(concept).map((r) => (r as { name: string }).name)).toEqual(['gele spliterwten']);
      expect(getRecipe(db, concept)).toMatchObject({ name: 'Erwtensoep', times_used: 1 });
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

  it('merges recipe names that differ only in case or spaces, keeping the approved one', () => {
    const db = getDb();
    db.exec('DROP INDEX IF EXISTS idx_recipes_name_nocase');
    const insert = db.prepare("INSERT INTO recipes (name, recipe_data, status, times_used) VALUES (?, '{}', ?, ?)");
    const concept = insert.run('soep ', 'concept', 3).lastInsertRowid as number;
    const approved = insert.run('Soep', 'goedgekeurd', 1).lastInsertRowid as number;
    const archived = insert.run(' SOEP', 'archief', 2).lastInsertRowid as number;
    insert.run('Stamppot ', 'concept', 0);
    const menuId = db.prepare("INSERT INTO menus (week_number, year) VALUES (21, 2026)").run().lastInsertRowid;
    const day = db.prepare("INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, recipe_id) VALUES (?, ?, 'Dag', 'x', '{}', ?)");
    day.run(menuId, 0, concept);
    day.run(menuId, 1, archived);

    dedupeRecipeNames(db);

    expect(db.prepare('SELECT id, name, times_used FROM recipes ORDER BY name').all()).toEqual([
      { id: approved, name: 'Soep', times_used: 6 },
      { id: expect.any(Number), name: 'Stamppot', times_used: 0 },
    ]);
    expect(db.prepare('SELECT DISTINCT recipe_id FROM menu_days WHERE menu_id = ?').all(menuId)).toEqual([{ recipe_id: approved }]);
    expect(() => insert.run('SOEP', 'concept', 0)).toThrow(/UNIQUE/);
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
