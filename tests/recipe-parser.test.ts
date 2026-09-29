import { describe, it, expect, vi, afterEach } from 'vitest';

process.env.LITELLM_URL = 'http://litellm.test:4000';
process.env.LITELLM_API_KEY = 'test-key';

const { parseRecipeText, extractJson } = await import('../server/services/recipe-parser');

function reply(content: string | null, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status, headers: { 'Content-Type': 'application/json' } },
  ));
}

describe('extractJson', () => {
  it('reads JSON wrapped in fences or chatter', () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Hier is het recept: {"a": {"b": 2}} Eet smakelijk!')).toEqual({ a: { b: 2 } });
  });

  it('fails clearly without an object', () => {
    expect(() => extractJson('Sorry, dat kan ik niet')).toThrow(/geen recept/);
    expect(() => extractJson('{niet: json}')).toThrow(/geen geldige JSON/);
  });
});

describe('parseRecipeText', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the text to the configured proxy and normalizes loose values', async () => {
    const fetchMock = reply(JSON.stringify({
      name: 'Curry',
      servings: '4',
      meal_type: 'rijst',
      prep_time_minutes: '35',
      ingredients: [
        { name: 'ui', amount: 2, unit: 'stuks', product_group: 'groenten', note: 'gesnipperd' },
        { name: 'zout', amount: null, unit: null, product_group: null },
        { name: ' ', amount: 1, unit: 'g', product_group: 'overig' },
      ],
      steps: ['Bakken'],
      tip: null,
      nutrition_per_serving: { calories: 500, protein_g: '20', fiber_g: 8, iron_mg: 3 },
    }));

    const recipe = await parseRecipeText('2 uien...');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://litellm.test:4000/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer test-key' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('cloud-gemma');
    expect(body.messages[1]).toEqual({ role: 'user', content: '2 uien...' });

    expect(recipe).toMatchObject({ name: 'Curry', servings: 4, prep_time_minutes: 35 });
    expect(recipe.ingredients).toEqual([
      { name: 'ui', amount: 2, unit: 'stuks', product_group: 'groenten', note: 'gesnipperd' },
      { name: 'zout', amount: null, unit: '', product_group: 'overig', note: null },
    ]);
    expect(recipe.nutrition_per_serving).toEqual({ calories: 500, protein_g: 20, fiber_g: 8, iron_mg: 3 });
  });

  it('falls back to sane defaults for missing fields', async () => {
    reply('{"name": "Iets", "ingredients": [{"name": "brood"}]}');
    const recipe = await parseRecipeText('brood');
    expect(recipe).toMatchObject({ servings: 4, prep_time_minutes: null, steps: [], nutrition_per_serving: null });
    expect(recipe.ingredients[0]).toMatchObject({ name: 'brood', amount: null, unit: '', product_group: 'overig' });
  });

  it('reports an empty (reasoning-only) answer', async () => {
    reply(null);
    await expect(parseRecipeText('x')).rejects.toThrow(/leeg antwoord/);
  });

  it('reports upstream errors without leaking the body', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reply('boom', 500);
    await expect(parseRecipeText('x')).rejects.toMatchObject({ status: 502, message: expect.stringContaining('500') });
  });

  it('reports an unreachable proxy', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    await expect(parseRecipeText('x')).rejects.toThrow(/niet bereiken/);
  });
});
