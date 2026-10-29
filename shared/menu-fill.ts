import {
  checkMenu, DraftDay, fitOf, KADERS, PlannerRecipe, problemsOf, ProteinTag, RecipeLookup, vegetableNorm,
} from './menu-rules';

/**
 * Putting a week ready by the family's rules, without a model: per open day
 * the approved dinner that suits it best, given the rest of the week. A few
 * shuffled rounds, keeping the week that keeps to the rules best, so it is
 * instant and still different from week to week.
 */

const WEEKEND = new Set(['Zaterdag', 'Zondag']);
// Rules broken weigh far more than preferences missed, as in the model's proposal
const BROKEN = 100;
const MISSED = 10;

const isOpen = (d: DraftDay) => !d.free && d.recipe_id === null;

/** Days since a date, for preferring what has not been on the table for a while. */
function daysSince(date: string | null, today: number): number {
  if (!date) return 365;
  const then = Date.parse(date);
  return Number.isFinite(then) ? Math.max(0, (today - then) / 86_400_000) : 365;
}

/**
 * How well a recipe suits day `index` of a partly planned week: higher is
 * better. Rules it would break count heavily, preferences less; then what the
 * week still needs (fish, pulses), the family's stars, and how long ago it was
 * planned. `jitter` (0–1) varies the order among equally good ones.
 */
export function suitability(days: DraftDay[], index: number, r: PlannerRecipe, lookup: RecipeLookup, jitter = 0, today = Date.now()): number {
  const others = days
    .map((d, i) => (i !== index && !d.free && d.recipe_id !== null ? lookup.get(d.recipe_id) : undefined))
    .filter((o): o is PlannerRecipe => o !== undefined);
  const count = (tag: ProteinTag) => others.filter((o) => o.protein.includes(tag)).length;
  let score = 0;

  // The day itself
  if (others.some((o) => o.id === r.id)) score -= 10 * BROKEN;
  if (r.veg_per_serving < KADERS.vegetables.minimum) score -= BROKEN;
  else if (r.veg_per_serving < vegetableNorm(r)) score -= MISSED;
  if (r.meal_missing.length) score -= BROKEN;
  if (!WEEKEND.has(days[index].day_name) && (r.prep_time_minutes ?? 0) > KADERS.weekdayMinutes) score -= MISSED;
  if (r.recent_weeks.length) score -= 1.5 * MISSED;
  const neighbours = [days[index - 1], days[index + 1]]
    .map((d) => (d && !d.free && d.recipe_id !== null ? lookup.get(d.recipe_id) : undefined));
  if (r.meal_type && neighbours.some((n) => n?.meal_type === r.meal_type)) score -= MISSED;
  if (r.meal_type && others.filter((o) => o.meal_type === r.meal_type).length >= KADERS.sameKindMax) score -= MISSED;

  // The week
  if (r.veg_exception) {
    score -= others.some((o) => o.veg_exception) ? BROKEN : 3;
  }
  if (r.protein.includes('vlees')) {
    const meat = count('vlees') + 1;
    if (meat > KADERS.meat.max) score -= BROKEN;
    else if (meat > KADERS.meat.preferred) score -= 0.8 * MISSED;
  }
  // Fish and pulses: count towards what is still needed, and leave room when the days run out
  const open = days.filter((d, i) => i === index || isOpen(d)).length;
  for (const [tag, min] of [['vis', KADERS.fish.min], ['peulvruchten', KADERS.legumes.min]] as const) {
    const need = min - count(tag);
    if (need <= 0) continue;
    if (r.protein.includes(tag)) score += need >= open ? 3 * MISSED : MISSED;
    else if (need >= open) score -= 4 * MISSED;
  }

  // Taste: stars (unrated counts as fair), and not too soon again
  score += 2 * (r.rating_avg ?? 3.5);
  score += Math.min(daysSince(r.last_used, today) / 14, 4);
  return score + 4 * jitter;
}

/** The approved dinners, the ones the week is put together from. */
function approved(recipes: PlannerRecipe[]): PlannerRecipe[] {
  return recipes.filter((r) => r.status === 'goedgekeurd');
}

/** How a whole week scores: rules broken, then preferences missed, then taste. Lower is better. */
function weekCost(days: DraftDay[], lookup: RecipeLookup): number {
  const { fails, warnings } = problemsOf(checkMenu(days, lookup), days);
  return fails.length * 1000 + warnings.length;
}

/**
 * Fill the open days of a week (not free, nothing chosen) with approved
 * dinners. Tries a number of shuffled rounds and keeps the one that keeps to
 * the rules best. Days that are filled already stay as they are.
 */
export function fillWeek(days: DraftDay[], recipes: PlannerRecipe[], random: () => number = Math.random, rounds = 30): DraftDay[] {
  const lookup: RecipeLookup = new Map(recipes.map((r) => [r.id, r]));
  const pool = approved(recipes);
  if (pool.length === 0 || !days.some(isOpen)) return days;
  const today = Date.now();

  let best: { days: DraftDay[]; cost: number } | null = null;
  for (let round = 0; round < rounds; round++) {
    const week = days.map((d) => ({ ...d }));
    // A different order of days each round, so an early day does not always get the pick
    const order = week.map((_, i) => i).filter((i) => isOpen(week[i]));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const index of order) {
      let pick: PlannerRecipe | null = null;
      let top = -Infinity;
      for (const r of pool) {
        const score = suitability(week, index, r, lookup, random(), today);
        if (score > top) { top = score; pick = r; }
      }
      if (pick) week[index] = { ...week[index], recipe_id: pick.id };
    }
    const cost = weekCost(week, lookup);
    if (!best || cost < best.cost) best = { days: week, cost };
    if (cost === 0) break;
  }
  return best!.days;
}

/**
 * Another dinner for day `index`: the best suited one that is not on the day
 * now and not in `skip` (what was offered for this day before), so asking
 * again goes through the alternatives. With `fitting`, only one that breaks
 * no rule. Null when there are none left.
 */
export function nextRecipe(
  days: DraftDay[], index: number, recipes: PlannerRecipe[], skip: ReadonlySet<number> = new Set(),
  { fitting = false, random = Math.random }: { fitting?: boolean; random?: () => number } = {},
): number | null {
  const lookup: RecipeLookup = new Map(recipes.map((r) => [r.id, r]));
  const current = days[index].recipe_id;
  const without = days.map((d, i) => (i === index ? { ...d, recipe_id: null, free: false } : d));
  const today = Date.now();
  let pick: number | null = null;
  let top = -Infinity;
  for (const r of approved(recipes)) {
    if (r.id === current || skip.has(r.id)) continue;
    if (fitting && fitOf(without, index, r, lookup).state === 'fail') continue;
    // A little jitter only: the next one should be the next best, not a lottery
    const score = suitability(without, index, r, lookup, random() * 0.25, today);
    if (score > top) { top = score; pick = r.id; }
  }
  return pick;
}
