// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-menu-chat.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const { saveRecipe, parseRecipeInput, RecipeError } = await import('../server/services/recipes');
const { chatAboutDay, parseChatRequest, CHAT_ATTEMPTS, CHAT_SYSTEM_PROMPT } = await import('../server/services/menu-chat');

type Ingredient = { name: string; amount: number; unit: string; product_group: string };
const rice: Ingredient = { name: 'zilvervliesrijst', amount: 300, unit: 'g', product_group: 'droogwaren' };
const veg = (name: string, g = 360): Ingredient => ({ name, amount: g * 4, unit: 'g', product_group: 'groenten' });

function recipe(name: string, main: Ingredient, extra: Record<string, unknown> = {}, vegetable = veg('courgette')) {
  return saveRecipe(getDb(), parseRecipeInput({
    name, servings: 4, status: 'goedgekeurd', meal_type: 'rijst', prep_time_minutes: 25,
    ingredients: [main, rice, vegetable], steps: ['Koken.'], ...extra,
  }));
}

const DAYS = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'];
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
  const chicken: Ingredient = { name: 'kipfilet', amount: 500, unit: 'g', product_group: 'vlees' };
  ids = {
    pompoen: recipe('Pompoencurry', { name: 'kikkererwten', amount: 500, unit: 'g', product_group: 'droogwaren' }, { meal_type: 'curry' }, veg('pompoen')),
    kip1: recipe('Kip teriyaki', chicken, { meal_type: 'wok' }),
    kip2: recipe('Wraps met kip', chicken, { meal_type: 'wrap' }),
    kip3: recipe('Nasi met kip', chicken, { meal_type: 'nasi' }),
    kip4: recipe('Kip tandoori', chicken, { meal_type: 'oven' }),
    concept: recipe('Pompoenrisotto', chicken, { status: 'concept' }, veg('pompoen')),
  };
});

/** A week with three meat days, and Saturday to choose. */
function request(question = 'Iets met pompoen?', extra: Record<string, unknown> = {}) {
  const chosen: Record<string, number> = { Donderdag: ids.kip1, Vrijdag: ids.kip2, Zondag: ids.kip3 };
  return parseChatRequest({
    week_number: 45, year: 2026, day_name: 'Zaterdag',
    days: DAYS.map((day_name) => ({ day_name, recipe_id: chosen[day_name] ?? null })),
    messages: [{ role: 'user', content: question }], ...extra,
  });
}

const answer = (fields: Record<string, unknown>) => JSON.stringify({ antwoord: 'Deze past mooi.', voorstellen: [], ...fields });

describe('the menu assistant', () => {
  it('sees the day, the rest of the week and the library in order of fit', async () => {
    const call = vi.fn().mockResolvedValue(answer({ voorstellen: [{ recipe_id: ids.pompoen, waarom: 'Pompoen, en peulvruchten.' }] }));
    const reply = await chatAboutDay(getDb(), request(), call);

    expect(reply).toEqual({
      reply: 'Deze past mooi.', suggestions: [{ recipe_id: ids.pompoen, reason: 'Pompoen, en peulvruchten.' }], model: CHAT_ATTEMPTS[0],
    });
    const [model, messages, , options] = call.mock.calls[0];
    expect(model).toBe(CHAT_ATTEMPTS[0]);
    expect(options).toMatchObject({ timeoutMs: 25_000 });
    const system = messages[0].content as string;
    expect(system.startsWith(CHAT_SYSTEM_PROMPT)).toBe(true);
    expect(system).toContain('Het gaat om Zaterdag 7 november (weekend), week 45.');
    expect(system).toContain('- Donderdag: Kip teriyaki');
    expect(system).toContain('- Maandag: nog niets gekozen');
    // What fits first; a fourth meat day says what goes wrong; concepts are not offered
    const list = system.slice(system.indexOf('## Recepten'));
    expect(list.indexOf('Pompoencurry')).toBeLessThan(list.indexOf('Kip tandoori'));
    expect(list).toMatch(/#\d+ Pompoencurry — .* · past/);
    expect(list).toMatch(/#\d+ Kip tandoori — .* · vlees 4× \(hooguit 3, liever 2\)/);
    expect(system).not.toContain('Pompoenrisotto');
    expect(messages[1]).toEqual({ role: 'user', content: 'Iets met pompoen?' });
  });

  it('keeps only recipes from the list, each once, at most three', async () => {
    const call = vi.fn().mockResolvedValue(answer({ voorstellen: [
      { recipe_id: ids.concept }, { recipe_id: 999 }, { recipe_id: `#${ids.pompoen}` }, { recipe_id: ids.pompoen },
      { recipe_id: ids.kip4 }, { recipe_id: ids.kip1 }, { recipe_id: ids.kip2 },
    ] }));
    const reply = await chatAboutDay(getDb(), request(), call);
    expect(reply.suggestions.map((s) => s.recipe_id)).toEqual([ids.pompoen, ids.kip4, ids.kip1]);
  });

  it('passes the earlier answers back as the model gave them', async () => {
    const call = vi.fn().mockResolvedValue(answer({}));
    await chatAboutDay(getDb(), request('Iets met pompoen?', { messages: [
      { role: 'user', content: 'Iets met pompoen?' },
      { role: 'assistant', content: 'Wat dacht je van de curry?', suggestions: [ids.pompoen] },
      { role: 'user', content: 'Liever zonder peulvruchten' },
    ] }), call);
    expect(call.mock.calls[0][1].slice(1)).toEqual([
      { role: 'user', content: 'Iets met pompoen?' },
      { role: 'assistant', content: JSON.stringify({ antwoord: 'Wat dacht je van de curry?', voorstellen: [{ recipe_id: ids.pompoen }] }) },
      { role: 'user', content: 'Liever zonder peulvruchten' },
    ]);
  });

  it('asks the fallback model when the first gives nothing usable, and says so when neither does', async () => {
    const call = vi.fn().mockResolvedValueOnce('Pompoen is lekker!').mockResolvedValueOnce(answer({ voorstellen: [{ recipe_id: ids.pompoen }] }));
    const reply = await chatAboutDay(getDb(), request(), call);
    expect(call.mock.calls.map((c) => c[0])).toEqual(CHAT_ATTEMPTS);
    expect(reply.model).toBe(CHAT_ATTEMPTS[1]);

    const never = vi.fn().mockResolvedValue('{}');
    await expect(chatAboutDay(getDb(), request(), never)).rejects.toThrow('De assistent gaf geen antwoord (geen bruikbaar antwoord)');
  });

  it('stops at once when the model cannot be reached', async () => {
    const call = vi.fn().mockRejectedValue(new RecipeError('Taalmodel niet bereikbaar (ECONNREFUSED)', 503));
    await expect(chatAboutDay(getDb(), request(), call)).rejects.toMatchObject({ status: 503 });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('needs a question about a day of the week', () => {
    expect(() => request('')).toThrow(/messages\.0\.content/);
    expect(() => request('Iets?', { day_name: 'Maandagavond' })).toThrow(/day_name/);
    expect(() => request('Iets?', { messages: [{ role: 'assistant', content: 'Hallo' }] })).toThrow('Er is geen vraag om te beantwoorden');
  });
});
