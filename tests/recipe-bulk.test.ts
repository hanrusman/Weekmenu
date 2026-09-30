import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-recipe-bulk.db');
process.env.DATABASE_PATH = TEST_DB_PATH;
process.env.LITELLM_URL = 'http://litellm.test:4000';
process.env.LITELLM_API_KEY = 'test-key';

const { getDb, closeDb } = await import('../server/db');
const { importRecipeText, BULK_JSON_INSTRUCTIONS } = await import('../server/services/recipe-parser');

function modelReturns(recipe: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify(recipe) } }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
}

const soup = {
  name: 'Tomatensoep',
  servings: 4,
  meal_type: 'soep',
  prep_time_minutes: 30,
  ingredients: [
    { name: 'ui', amount: 1, unit: 'stuks', product_group: 'groenten', note: 'gesnipperd' },
    { name: 'tomaat', amount: 800, unit: 'g', product_group: 'groenten' },
  ],
  steps: ['Fruit de ui', '  ', 'Kook de tomaten'],
  tip: null,
  nutrition_per_serving: null,
};

describe('Bulk recipe import', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });
  afterAll(() => {
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });
  beforeEach(() => getDb().exec('DELETE FROM recipes; DELETE FROM recipe_ingredients;'));
  afterEach(() => vi.restoreAllMocks());

  it('reads a recipe with the model and stores it as concept, with its source', async () => {
    modelReturns(soup);
    const recipe = await importRecipeText(getDb(), '### Tomatensoep\n- 1 ui', { title: 'Tomatensoep', source: 'Snel en simpel.md' }) as Record<string, unknown>;

    expect(recipe).toMatchObject({ name: 'Tomatensoep', status: 'concept', source: 'Snel en simpel.md', meal_type: 'soep', prep_time_minutes: 30 });
    const data = JSON.parse(recipe.recipe_data as string);
    expect(data.steps).toEqual(['Fruit de ui', 'Kook de tomaten']);
    expect(data.ingredients[0]).toMatchObject({ name: 'ui', note: 'gesnipperd' });
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM recipe_ingredients WHERE recipe_id = ?').get(recipe.id)).toEqual({ c: 2 });
  });

  it('falls back to the section title when the model found no name', async () => {
    modelReturns({ ...soup, name: '' });
    const recipe = await importRecipeText(getDb(), 'tekst', { title: 'Soep van de dag' }) as { name: string };
    expect(recipe.name).toBe('Soep van de dag');
  });

  it('refuses a text without ingredients and a recipe that already exists', async () => {
    modelReturns({ ...soup, ingredients: [] });
    await expect(importRecipeText(getDb(), 'tekst')).rejects.toMatchObject({ status: 422 });

    modelReturns(soup);
    await importRecipeText(getDb(), 'tekst');
    modelReturns({ ...soup, name: 'TOMATENSOEP' });
    await expect(importRecipeText(getDb(), 'tekst')).rejects.toMatchObject({ status: 409 });
    expect(getDb().prepare('SELECT COUNT(*) AS c FROM recipes').get()).toEqual({ c: 1 });
  });

  it('keeps a long source name within bounds and drops an impossible prep time', async () => {
    modelReturns({ ...soup, prep_time_minutes: 99999 });
    const recipe = await importRecipeText(getDb(), 'tekst', { source: 'x'.repeat(80) }) as { source: string; prep_time_minutes: number | null };
    expect(recipe.source).toHaveLength(50);
    expect(recipe.prep_time_minutes).toBeNull();
  });

  it("asks Claude for an array in the parser's own format", () => {
    expect(BULK_JSON_INSTRUCTIONS).toMatch(/^Zet de recepten om naar JSON voor de Weekmenu-app: een JSON-array/);
    expect(BULK_JSON_INSTRUCTIONS).toContain('"ingredients": [');
    expect(BULK_JSON_INSTRUCTIONS).not.toContain('Antwoord met ALLEEN het JSON-object');
  });
});
