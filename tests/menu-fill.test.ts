import { describe, it, expect } from 'vitest';
import { checkMenu, problemsOf, DraftDay, PlannerRecipe } from '../shared/menu-rules';
import { fillWeek, nextRecipe } from '../shared/menu-fill';

let nextId = 1;
function dinner(name: string, fields: Partial<PlannerRecipe> = {}): PlannerRecipe {
  return {
    id: nextId++, name, status: 'goedgekeurd', meal_type: name, prep_time_minutes: 25, cost_index: '€',
    protein: [], veg_per_serving: 360, veg_exception: false, meal_missing: [], rating_avg: null, rating_count: 0,
    recent_weeks: [], last_used: null, recipe_image_version: null, ingredients: [], ...fields,
  };
}

/** A repeatable random, so a test sees the same week every run. */
function seeded(seed = 7): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'];
const empty = (): DraftDay[] => DAYS.map((day_name) => ({ day_name, date: null, recipe_id: null }));

const library = [
  dinner('Zalm', { protein: ['vis'] }),
  dinner('Kabeljauw', { protein: ['vis'] }),
  dinner('Tonijnpasta', { protein: ['vis'] }),
  dinner('Linzensoep', { protein: ['peulvruchten'] }),
  dinner('Kikkererwtencurry', { protein: ['peulvruchten'] }),
  dinner('Bonenchili', { protein: ['peulvruchten'] }),
  dinner('Kip tandoori', { protein: ['vlees'], prep_time_minutes: 50 }),
  dinner('Gehaktballen', { protein: ['vlees'] }),
  dinner('Nasi', { protein: ['vlees'] }),
  dinner('Wraps met kip', { protein: ['vlees'] }),
  dinner('Pasta pesto', { meal_missing: ['eiwit'], rating_avg: 5 }),
  dinner('Shakshuka'),
  dinner('Groentesoep', { veg_per_serving: 200 }),
  dinner('Pizza', { veg_exception: true, veg_per_serving: 260 }),
  dinner('Nieuwe stoof', { status: 'concept' }),
];
const lookup = new Map(library.map((r) => [r.id, r]));
const byName = (name: string) => library.find((r) => r.name === name)!;
const names = (days: DraftDay[]) => days.map((d) => (d.recipe_id === null ? null : lookup.get(d.recipe_id)!.name));

describe('putting a week ready', () => {
  it('fills every day within the rules, from approved dinners only', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const week = fillWeek(empty(), library, seeded(seed));
      expect(week.every((d) => d.recipe_id !== null)).toBe(true);
      expect(problemsOf(checkMenu(week, lookup), week).fails).toEqual([]);
      expect(names(week)).not.toContain('Nieuwe stoof');
      expect(names(week)).not.toContain('Pasta pesto');
      expect(names(week)).not.toContain('Groentesoep');
    }
  });

  it('puts the long dinner in the weekend', () => {
    for (const seed of [1, 2, 3]) {
      const week = fillWeek(empty(), library, seeded(seed));
      const tandoori = names(week).indexOf('Kip tandoori');
      if (tandoori !== -1) expect(['Zaterdag', 'Zondag']).toContain(DAYS[tandoori]);
    }
  });

  it('leaves the chosen and free days as they are', () => {
    const days = empty();
    days[0].recipe_id = byName('Gehaktballen').id;
    days[0].chosen = true;
    days[3].free = true;
    const week = fillWeek(days, library, seeded());
    expect(week[0]).toEqual(days[0]);
    expect(week[3]).toEqual({ day_name: 'Zondag', date: null, recipe_id: null, free: true });
    expect(week.filter((d) => d.recipe_id !== null)).toHaveLength(6);
  });

  it('only plans what was on the menu lately when nothing else will do', () => {
    const recent = library.map((r) => (r.name === 'Zalm' ? { ...r, recent_weeks: [44] } : r));
    for (const seed of [1, 2, 3]) {
      expect(names(fillWeek(empty(), recent, seeded(seed)))).not.toContain('Zalm');
    }
  });

  it('gives a different week from time to time', () => {
    const weeks = new Set([1, 2, 3, 4, 5, 6].map((seed) => names(fillWeek(empty(), library, seeded(seed))).join()));
    expect(weeks.size).toBeGreaterThan(1);
  });
});

describe('another recipe for one day', () => {
  it('offers the next best one that fits, and goes through the alternatives', () => {
    const week = fillWeek(empty(), library, seeded());
    const seen = new Set<number>();
    const offered: number[] = [];
    let next = nextRecipe(week, 1, library, seen, { random: seeded() });
    while (next !== null) {
      expect(next).not.toBe(week[1].recipe_id);
      offered.push(next);
      seen.add(next);
      next = nextRecipe(week, 1, library, seen, { random: seeded() });
    }
    // Every approved dinner but the one on the day, each once
    expect(new Set(offered).size).toBe(offered.length);
    expect(offered).toHaveLength(library.filter((r) => r.status === 'goedgekeurd').length - 1);
    // What fits comes before what breaks a rule
    const first = lookup.get(offered[0])!;
    expect(first.meal_missing).toEqual([]);
    expect(lookup.get(offered[offered.length - 1])!.name).not.toBe(first.name);
  });

  it('only offers what keeps to the rules when asked to', () => {
    const week = fillWeek(empty(), library, seeded());
    const seen = new Set<number>();
    let next = nextRecipe(week, 1, library, seen, { fitting: true, random: seeded() });
    while (next !== null) {
      const fit = problemsOf(checkMenu(week.map((d, i) => (i === 1 ? { ...d, recipe_id: next } : d)), lookup),
        week.map((d, i) => (i === 1 ? { ...d, recipe_id: next } : d)));
      expect(fit.fails.filter((f) => f.startsWith('Vrijdag'))).toEqual([]);
      seen.add(next);
      next = nextRecipe(week, 1, library, seen, { fitting: true, random: seeded() });
    }
    expect([...seen].map((id) => lookup.get(id)!.name)).not.toContain('Pasta pesto');
    expect(seen.size).toBeGreaterThan(0);
  });
});
