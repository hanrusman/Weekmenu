import { describe, it, expect } from 'vitest';
import {
  checkMenu, fitOf, problemsOf, KADERS, DraftDay, PlannerRecipe, RecipeLookup,
} from '../shared/menu-rules';
import { VEGETABLE_MINIMUM, VEGETABLE_TARGET } from '../server/services/vegetables';

let nextId = 1;
function dinner(name: string, fields: Partial<PlannerRecipe> = {}): PlannerRecipe {
  return {
    id: nextId++, name, status: 'goedgekeurd', meal_type: 'pasta', prep_time_minutes: 25, cost_index: '€',
    protein: [], veg_per_serving: 360, veg_exception: false, meal_missing: [], rating_avg: null, rating_count: 0,
    recent_weeks: [], last_used: null, recipe_image_version: null, ingredients: [], ...fields,
  };
}

const DAYS = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'];

function week(...recipes: Array<PlannerRecipe | null | 'vrij'>): DraftDay[] {
  return DAYS.map((day_name, i) => {
    const r = recipes[i];
    return { day_name, date: null, recipe_id: r && r !== 'vrij' ? r.id : null, free: r === 'vrij' };
  });
}

function lookup(...recipes: PlannerRecipe[]): RecipeLookup {
  return new Map(recipes.map((r) => [r.id, r]));
}

const state = (check: ReturnType<typeof checkMenu>, key: string) => check.week.find((c) => c.key === key)!;

// A week that keeps to every rule: 2 fish, 2 pulses, 2 meat, 1 vegetarian, kinds alternating
const zalm = dinner('Zalm uit de oven', { protein: ['vis'], meal_type: 'oven' });
const curry = dinner('Kikkererwtencurry', { protein: ['peulvruchten'], meal_type: 'rijst' });
const kip = dinner('Kip tandoori', { protein: ['vlees'], meal_type: 'oven', prep_time_minutes: 50 });
const soep = dinner('Linzensoep', { protein: ['peulvruchten'], meal_type: 'soep' });
const pasta = dinner('Pasta pesto', { meal_type: 'pasta' });
const wrap = dinner('Wraps met gehakt', { protein: ['vlees'], meal_type: 'wrap' });
const vis = dinner('Visstoof', { protein: ['vis'], meal_type: 'soep' });
const good = [zalm, curry, kip, soep, pasta, wrap, vis];

describe('a week of dinners', () => {
  it('uses the same vegetable norm as the server', () => {
    expect(KADERS.vegetables).toEqual({ target: VEGETABLE_TARGET, minimum: VEGETABLE_MINIMUM });
  });

  it('passes a week that keeps to every rule', () => {
    const check = checkMenu(week(...good), lookup(...good));
    expect(check.state).toBe('ok');
    expect(check.days.every((d) => d.checks.length === 0)).toBe(true);
    expect(state(check, 'vis')).toMatchObject({ state: 'ok', detail: '2× (minstens 2)' });
    expect(state(check, 'groente')).toMatchObject({ state: 'ok', detail: '7 van 7 avonden op norm · gem. 360 g' });
  });

  it('tells per day what is off: vegetables, a missing part, time on a weekday, a recent repeat', () => {
    const thin = dinner('Pasta carbonara', { veg_per_serving: 120, meal_missing: ['eiwit'], prep_time_minutes: 45, recent_weeks: [43] });
    const days = week(zalm, curry, kip, soep, thin, wrap, vis);
    const check = checkMenu(days, lookup(...good, thin));
    expect(check.days[4].state).toBe('fail');
    expect(check.days[4].checks.map((c) => c.detail)).toEqual([
      '120 g groente (doel 350 g)', 'mist eiwit', '45 min op een doordeweekse dag', 'ook in week 43',
    ]);
    // Saturday may take long
    expect(check.days[2].checks).toEqual([]);
  });

  it('holds an exception to the minimum and to once a week', () => {
    const pizza = dinner('Pizza', { veg_exception: true, veg_per_serving: 260, meal_type: 'oven' });
    const pizza2 = dinner('Turkse pizza', { veg_exception: true, veg_per_serving: 260, meal_type: 'wrap' });
    const once = checkMenu(week(zalm, curry, pizza, soep, pasta, wrap, vis), lookup(...good, pizza));
    expect(once.days[2].checks).toEqual([]);
    expect(state(once, 'uitzondering').state).toBe('ok');

    const twice = checkMenu(week(zalm, curry, pizza, soep, pizza2, wrap, vis), lookup(...good, pizza, pizza2));
    expect(state(twice, 'uitzondering')).toMatchObject({ state: 'fail', detail: '2× (hooguit 1)' });
  });

  it('counts fish and pulses as open while there are days left, then as short', () => {
    const empty = checkMenu(week(), lookup());
    expect(state(empty, 'vis').state).toBe('open');
    expect(state(empty, 'dagen')).toMatchObject({ state: 'open', detail: '0 van 7 gekozen' });

    const noFish = [curry, kip, soep, pasta, wrap, curry, soep];
    const full = checkMenu(week(...noFish), lookup(...good));
    expect(state(full, 'vis')).toMatchObject({ state: 'fail', detail: '0× (minstens 2)' });

    const oneFish = checkMenu(week(zalm, curry, kip, soep, pasta, wrap, pasta), lookup(...good));
    expect(state(oneFish, 'vis').state).toBe('warn');
  });

  it('does not count a free day as one still to fill', () => {
    const check = checkMenu(week(zalm, curry, kip, 'vrij', pasta, wrap, vis), lookup(...good));
    expect(state(check, 'dagen')).toMatchObject({ state: 'ok', detail: '6 van 6 gekozen' });
    expect(state(check, 'peulvruchten')).toMatchObject({ state: 'warn', detail: '1× (minstens 2)' });
  });

  it('allows meat twice, warns on the third time and fails on the fourth', () => {
    const meat = (n: number) => Array.from({ length: n }, (_, i) => dinner(`Vlees ${i}`, { protein: ['vlees'], meal_type: `soort ${i}` }));
    const three = meat(3);
    expect(state(checkMenu(week(...three), lookup(...three)), 'vlees').state).toBe('warn');
    const four = meat(4);
    expect(state(checkMenu(week(...four), lookup(...four)), 'vlees').state).toBe('fail');
  });

  it('fails a recipe planned twice and warns on the same kind on two days running or too often', () => {
    const pasta2 = dinner('Pasta arrabbiata', { meal_type: 'pasta' });
    const pasta3 = dinner('Lasagne', { meal_type: 'pasta' });
    const days = week(zalm, pasta, pasta2, soep, pasta3, curry, zalm);
    const check = checkMenu(days, lookup(...good, pasta2, pasta3));
    expect(check.days[0].checks.map((c) => c.detail)).toEqual(['staat ook op woensdag']);
    expect(check.days[2].checks.map((c) => c.detail)).toEqual(['weer pasta, net als vrijdag']);
    expect(state(check, 'herhaling')).toMatchObject({ state: 'fail', detail: '1 recept dubbel' });
    expect(state(check, 'soort')).toMatchObject({ state: 'warn', detail: '3× pasta' });
  });

  it('lists what is wrong for the model, without telling the day problems twice', () => {
    const thin = dinner('Groene curry', { veg_per_serving: 200, protein: ['vlees'], meal_type: 'rijst' });
    const days = week(curry, kip, thin, soep, wrap, pasta, null);
    const { fails, warnings } = problemsOf(checkMenu(days, lookup(...good, thin)), days);
    expect(fails).toEqual(['Zaterdag: 200 g groente (doel 350 g)', 'Vis: 0× (minstens 2)']);
    expect(warnings).toEqual(['Vrijdag: 50 min op een doordeweekse dag', 'Vlees: 3× (hooguit 3, liever 2)']);
  });
});

describe('how a recipe fits a day', () => {
  it('fits a recipe that keeps to the rules, and says which minimum it helps', () => {
    const days = week(null, curry, kip, soep, pasta, wrap, vis);
    expect(fitOf(days, 0, zalm, lookup(...good))).toEqual({ state: 'ok', problems: [], helps: ['vis'] });
  });

  it('names the week rules a recipe would break', () => {
    const steak = dinner('Biefstuk', { protein: ['vlees'], meal_type: 'oven' });
    const days = week(null, curry, kip, soep, pasta, wrap, vis);
    const fit = fitOf(days, 0, steak, lookup(...good, steak));
    expect(fit.state).toBe('warn');
    expect(fit.problems).toEqual([
      { state: 'warn', detail: 'te weinig vis: 1× (minstens 2)' },
      { state: 'warn', detail: 'vlees 3× (hooguit 3, liever 2)' },
    ]);
  });

  it('takes the day as it would be: its own problems and a recipe chosen on another day', () => {
    const days = week(null, curry, kip, soep, pasta, wrap, vis);
    const fit = fitOf(days, 0, vis, lookup(...good));
    expect(fit.state).toBe('fail');
    expect(fit.problems[0]).toEqual({ state: 'fail', detail: 'staat ook op woensdag' });
  });
});
