/**
 * The family's rules for a week of dinners, in one place: the menu picker
 * shows per day and per week whether a draft keeps to them, and the server
 * holds a model's proposal to the same rules before the picker gets it.
 * Pure functions on what the library knows of each recipe, so client and
 * server reach the same verdict.
 */

/** The rules, as the picker and the model are told them. */
export const KADERS = {
  /** Grams of vegetables per adult serving; an exception (pizza night) at least the minimum, as in server/services/vegetables.ts. */
  vegetables: { target: 350, minimum: 250 },
  /** Dinners with fish, and with pulses, per week. */
  fish: { min: 2 },
  legumes: { min: 2 },
  /** Dinners with meat per week: at most 3, preferably 2. */
  meat: { max: 3, preferred: 2 },
  /** Exceptions to the vegetable aim per week. */
  exceptions: { max: 1 },
  /** On a weekday (Monday to Friday) dinner is preferably quick. */
  weekdayMinutes: 30,
  /** The same kind of dish (pasta, soep…) at most this often a week. */
  sameKindMax: 2,
  /** What was planned in this many weeks before the planned one is better not repeated. */
  recentWeeks: 3,
} as const;

/** The days of a menu week, which runs Thursday to Wednesday. */
export const MENU_DAYS = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'] as const;
export type DayName = typeof MENU_DAYS[number];

const WEEKEND = new Set(['Zaterdag', 'Zondag']);

export type ProteinTag = 'vis' | 'vlees' | 'peulvruchten';

/** A dinner from the library, with what the rules need to know of it. */
export interface PlannerRecipe {
  id: number;
  name: string;
  status: string;
  meal_type: string | null;
  prep_time_minutes: number | null;
  cost_index: string | null;
  /** Fish, meat and pulses it holds; empty for a vegetarian dinner without pulses. */
  protein: ProteinTag[];
  veg_per_serving: number;
  veg_exception: boolean;
  /** What it lacks to be a whole meal. */
  meal_missing: Array<'koolhydraten' | 'eiwit'>;
  rating_avg: number | null;
  rating_count: number;
  /** The weeks just before the one being planned that it was on the menu, most recent first. */
  recent_weeks: number[];
  last_used: string | null;
  recipe_image_version: number | null;
  /** Its main ingredients, for search and for the model. */
  ingredients: string[];
}

/** One day of a draft week: a recipe, nothing chosen yet, or no dinner to plan (free). */
export interface DraftDay {
  day_name: string;
  date: string | null;
  recipe_id: number | null;
  free?: boolean;
}

/** ok; open: not met yet but still possible with the days left; warn: a preference missed; fail: a rule broken. */
export type CheckState = 'ok' | 'open' | 'warn' | 'fail';

/** How bad a state is, for sorting: ok first. */
export const CHECK_RANK: Record<CheckState, number> = { ok: 0, open: 1, warn: 2, fail: 3 };

export function worst(states: CheckState[]): CheckState {
  return states.reduce<CheckState>((a, b) => (CHECK_RANK[b] > CHECK_RANK[a] ? b : a), 'ok');
}

export function worse(a: CheckState, b: CheckState): boolean {
  return CHECK_RANK[a] > CHECK_RANK[b];
}

export interface Check {
  key: string;
  label: string;
  state: CheckState;
  detail: string;
  /** For the week's counts: "1/2", "3×". */
  short?: string;
}

export interface DayCheck {
  day_name: string;
  /** ok for a day without a recipe. */
  state: CheckState;
  /** Only what is not ok. */
  checks: Check[];
}

export interface MenuCheck {
  days: DayCheck[];
  week: Check[];
  state: CheckState;
}

export type RecipeLookup = Map<number, PlannerRecipe>;

const isWeekday = (dayName: string) => !WEEKEND.has(dayName);

/** "vrijdag" for in a sentence. */
const lower = (dayName: string) => dayName.toLowerCase();

/** The norm a dinner is held to: the aim, or the minimum for an exception. */
export function vegetableNorm(recipe: Pick<PlannerRecipe, 'veg_exception'>): number {
  return recipe.veg_exception ? KADERS.vegetables.minimum : KADERS.vegetables.target;
}

function vegetableCheck(r: PlannerRecipe): Check {
  const norm = vegetableNorm(r);
  const g = r.veg_per_serving;
  const state: CheckState = g >= norm ? 'ok' : g >= KADERS.vegetables.minimum ? 'warn' : 'fail';
  const detail = r.veg_exception
    ? `uitzondering: ${g} g groente (minstens ${norm} g)`
    : `${g} g groente${g < norm ? ` (doel ${norm} g)` : ''}`;
  return { key: 'groente', label: 'Groente', state, detail };
}

/** The checks of one day that are not ok, given the whole draft. */
function dayChecks(days: DraftDay[], i: number, recipes: RecipeLookup): Check[] {
  const day = days[i];
  const r = day.recipe_id !== null ? recipes.get(day.recipe_id) : undefined;
  if (!r) return [];
  const checks: Check[] = [vegetableCheck(r)];
  if (r.meal_missing.length) {
    checks.push({ key: 'maaltijd', label: 'Hele maaltijd', state: 'fail', detail: `mist ${r.meal_missing.join(' en ')}` });
  }
  if (isWeekday(day.day_name) && (r.prep_time_minutes ?? 0) > KADERS.weekdayMinutes) {
    checks.push({ key: 'tijd', label: 'Tijd', state: 'warn', detail: `${r.prep_time_minutes} min op een doordeweekse dag` });
  }
  const twin = days.find((d, j) => j !== i && !d.free && d.recipe_id === r.id);
  if (twin) {
    checks.push({ key: 'dubbel', label: 'Dubbel', state: 'fail', detail: `staat ook op ${lower(twin.day_name)}` });
  }
  if (r.recent_weeks.length) {
    checks.push({ key: 'recent', label: 'Recent', state: 'warn', detail: `ook in week ${r.recent_weeks[0]}` });
  }
  const previous = i > 0 && !days[i - 1].free ? days[i - 1].recipe_id : null;
  const before = previous !== null ? recipes.get(previous) : undefined;
  if (before && r.meal_type && before.meal_type === r.meal_type && before.id !== r.id) {
    checks.push({ key: 'soort', label: 'Soort', state: 'warn', detail: `weer ${r.meal_type}, net als ${lower(days[i - 1].day_name)}` });
  }
  return checks.filter((c) => c.state !== 'ok');
}

/**
 * At least `min` dinners of a kind: met, still possible with the days left
 * (open), one short (warn), or further off (fail).
 */
function atLeast(count: number, min: number, left: number): CheckState {
  if (count >= min) return 'ok';
  if (count + left >= min) return 'open';
  return count >= min - 1 ? 'warn' : 'fail';
}

const times = (n: number) => `${n}×`;

/** Per day and for the week, how a draft keeps to the rules. */
export function checkMenu(days: DraftDay[], recipes: RecipeLookup): MenuCheck {
  const planned = days.filter((d) => !d.free);
  const chosen = planned
    .map((d) => (d.recipe_id !== null ? recipes.get(d.recipe_id) : undefined))
    .filter((r): r is PlannerRecipe => r !== undefined);
  const left = planned.length - chosen.length;
  const count = (tag: ProteinTag) => chosen.filter((r) => r.protein.includes(tag)).length;

  const dayResults: DayCheck[] = days.map((d, i) => {
    const checks = d.free ? [] : dayChecks(days, i, recipes);
    return { day_name: d.day_name, state: worst(checks.map((c) => c.state)), checks };
  });

  const week: Check[] = [];

  week.push({
    key: 'dagen', label: 'Dagen',
    state: left > 0 ? 'open' : 'ok',
    detail: `${chosen.length} van ${planned.length} gekozen`,
    short: `${chosen.length}/${planned.length}`,
  });

  const veg = chosen.map(vegetableCheck);
  const reached = veg.filter((c) => c.state === 'ok').length;
  const average = chosen.length ? Math.round(chosen.reduce((s, r) => s + r.veg_per_serving, 0) / chosen.length) : 0;
  week.push({
    key: 'groente', label: 'Groente',
    state: chosen.length ? worst(veg.map((c) => c.state)) : 'open',
    detail: chosen.length ? `${reached} van ${chosen.length} avonden op norm · gem. ${average} g` : 'nog niets gekozen',
    short: chosen.length ? `${reached}/${chosen.length}` : '–',
  });

  const fish = count('vis');
  week.push({
    key: 'vis', label: 'Vis',
    state: atLeast(fish, KADERS.fish.min, left), detail: `${times(fish)} (minstens ${KADERS.fish.min})`, short: `${fish}/${KADERS.fish.min}`,
  });
  const legumes = count('peulvruchten');
  week.push({
    key: 'peulvruchten', label: 'Peulvruchten',
    state: atLeast(legumes, KADERS.legumes.min, left), detail: `${times(legumes)} (minstens ${KADERS.legumes.min})`,
    short: `${legumes}/${KADERS.legumes.min}`,
  });
  const meat = count('vlees');
  week.push({
    key: 'vlees', label: 'Vlees',
    state: meat > KADERS.meat.max ? 'fail' : meat > KADERS.meat.preferred ? 'warn' : 'ok',
    detail: `${times(meat)} (hooguit ${KADERS.meat.max}, liever ${KADERS.meat.preferred})`,
    short: times(meat),
  });
  const exceptions = chosen.filter((r) => r.veg_exception).length;
  week.push({
    key: 'uitzondering', label: 'Uitzondering',
    state: exceptions > KADERS.exceptions.max ? 'fail' : 'ok',
    detail: `${times(exceptions)} (hooguit ${KADERS.exceptions.max})`,
    short: times(exceptions),
  });
  const whole = chosen.filter((r) => r.meal_missing.length === 0).length;
  week.push({
    key: 'maaltijd', label: 'Hele maaltijd',
    state: whole < chosen.length ? 'fail' : chosen.length ? 'ok' : 'open',
    detail: chosen.length ? `${whole} van ${chosen.length}` : 'nog niets gekozen',
    short: `${whole}/${chosen.length}`,
  });

  // The same recipe twice breaks it; a recent repeat is a preference missed (both shown per day too)
  const ids = chosen.map((r) => r.id);
  const doubled = new Set(ids.filter((id, i) => ids.indexOf(id) !== i)).size;
  const recent = chosen.filter((r) => r.recent_weeks.length).length;
  week.push({
    key: 'herhaling', label: 'Herhaling',
    state: doubled ? 'fail' : recent ? 'warn' : 'ok',
    detail: [
      doubled ? `${doubled} ${doubled === 1 ? 'recept' : 'recepten'} dubbel` : '',
      recent ? `${recent} recent gepland` : '',
    ].filter(Boolean).join(' · ') || 'niets herhaald',
    short: String(doubled + recent),
  });
  const kinds = new Map<string, number>();
  for (const r of chosen) if (r.meal_type) kinds.set(r.meal_type, (kinds.get(r.meal_type) ?? 0) + 1);
  const often = [...kinds].filter(([, n]) => n > KADERS.sameKindMax).map(([kind, n]) => `${n}× ${kind}`);
  week.push({
    key: 'soort', label: 'Afwisseling',
    state: often.length ? 'warn' : 'ok',
    detail: often.length ? often.join(' · ') : `elke soort hooguit ${KADERS.sameKindMax}×`,
    short: often[0] ?? '',
  });
  const slow = days.filter((d, i) => !d.free && dayResults[i].checks.some((c) => c.key === 'tijd')).length;
  week.push({
    key: 'tijd', label: 'Doordeweeks snel',
    state: slow ? 'warn' : 'ok',
    detail: slow ? `${slow} ${slow === 1 ? 'avond' : 'avonden'} langer dan ${KADERS.weekdayMinutes} min` : `alles hooguit ${KADERS.weekdayMinutes} min`,
    short: String(slow),
  });

  return { days: dayResults, week, state: worst([...week.map((c) => c.state), ...dayResults.map((d) => d.state)]) };
}

/** Week checks that sum up the days, whose problems are told per day already. */
const PER_DAY = new Set(['dagen', 'groente', 'maaltijd', 'herhaling', 'tijd']);

/** What is wrong with a draft, by how bad: rules broken, and preferences missed. */
export function problemsOf(check: MenuCheck, days: DraftDay[]): { fails: string[]; warnings: string[] } {
  const fails: string[] = [];
  const warnings: string[] = [];
  check.days.forEach((d, i) => {
    for (const c of d.checks) (c.state === 'fail' ? fails : warnings).push(`${days[i].day_name}: ${c.detail}`);
  });
  for (const c of check.week) {
    if (PER_DAY.has(c.key)) continue;
    if (c.state === 'fail') fails.push(`${c.label}: ${c.detail}`);
    else if (c.state === 'warn') warnings.push(`${c.label}: ${c.detail}`);
  }
  return { fails, warnings };
}

export interface Fit {
  /** The worst that choosing it causes, on the day and for the week. */
  state: CheckState;
  /** What goes wrong: the day's own problems, and week rules it gets further from. */
  problems: Array<{ state: CheckState; detail: string }>;
  /** Week minimums it counts towards that are not met yet ("vis"). */
  helps: ProteinTag[];
}

/** How a recipe would fit on day `index` of the draft, compared to leaving that day open. */
export function fitOf(days: DraftDay[], index: number, recipe: PlannerRecipe, recipes: RecipeLookup): Fit {
  const without = days.map((d, i) => (i === index ? { ...d, recipe_id: null, free: false } : d));
  const withIt = days.map((d, i) => (i === index ? { ...d, recipe_id: recipe.id, free: false } : d));
  const before = checkMenu(without, recipes);
  const after = checkMenu(withIt, recipes);

  const problems = after.days[index].checks.map((c) => ({ state: c.state, detail: c.detail }));
  after.week.forEach((c, i) => {
    if (!PER_DAY.has(c.key) && worse(c.state, before.week[i].state)) {
      const label = c.label.toLowerCase();
      // A minimum is not broken by this recipe but by the days running out
      const short = c.key === 'vis' || c.key === 'peulvruchten';
      problems.push({ state: c.state, detail: short ? `te weinig ${label}: ${c.detail}` : `${label} ${c.detail}` });
    }
  });
  const others = without
    .map((d) => (d.recipe_id !== null && !d.free ? recipes.get(d.recipe_id) : undefined))
    .filter((r): r is PlannerRecipe => r !== undefined);
  const minimum: Partial<Record<ProteinTag, number>> = { vis: KADERS.fish.min, peulvruchten: KADERS.legumes.min };
  const helps = recipe.protein.filter((tag) => {
    const min = minimum[tag];
    return min !== undefined && others.filter((r) => r.protein.includes(tag)).length < min;
  });
  return { state: worst(problems.map((p) => p.state)), problems, helps };
}
