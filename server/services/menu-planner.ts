import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  checkMenu, DraftDay, KADERS, MENU_DAYS, PlannerRecipe, problemsOf, RecipeLookup,
} from '../../shared/menu-rules.js';
import type { MenuProposal, PlannerExtra, PlannerState, ProposalJob, ProposalRequest } from '../../shared/menu-planner.js';
import { assessRecipes, RecipeError } from './recipes.js';
import { BREAKFASTS_PER_WEEK, SNACKS_PER_WEEK, familyNotes, formatStars, proteinTags } from './planning.js';
import { menuWeekDays, shiftWeek } from './menu-generator.js';
import { extractJson } from './recipe-parser.js';
import { callModel, ChatMessage, isModelConfigured, ModelCall } from './llm.js';

/**
 * Planning a week in the app itself: the picker gets the library with what
 * the rules need of each dinner, and a model can propose the open days. The
 * model chooses from the approved recipes by number; the app checks its week
 * against the same rules as the picker and hands it back with what is wrong,
 * a few times, before the picker gets the best one with what is still off.
 */

/** The dinners the picker offers (approved, then concept) and any others in `include`, with their facts. */
export function plannerRecipes(db: Database.Database, week: number, year: number, include: number[] = []): PlannerRecipe[] {
  const rows = db.prepare(`
    SELECT r.id, r.name, r.status, r.meal_type, r.prep_time_minutes, r.cost_index, r.veg_exception, r.last_used,
           r.image_version, COUNT(df.stars) AS rating_count, ROUND(AVG(df.stars), 1) AS rating_avg
    FROM recipes r
    LEFT JOIN menu_days md ON md.recipe_id = r.id
    LEFT JOIN day_feedback df ON df.day_id = md.id
    WHERE (r.course = 'hoofdgerecht' AND r.status IN ('goedgekeurd', 'concept'))
       OR r.id IN (SELECT value FROM json_each(?))
    GROUP BY r.id
    ORDER BY r.status = 'concept', r.name
  `).all(JSON.stringify(include)) as Array<{
    id: number; name: string; status: string; meal_type: string | null; prep_time_minutes: number | null;
    cost_index: string | null; veg_exception: number; last_used: string | null; image_version: number | null;
    rating_count: number; rating_avg: number | null;
  }>;
  const ids = JSON.stringify(rows.map((r) => r.id));

  const ingredients = new Map<number, Array<{ name: string; product_group: string }>>();
  const lines = db.prepare(`
    SELECT ri.recipe_id, i.name, i.product_group FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id IN (SELECT value FROM json_each(?)) ORDER BY ri.recipe_id, ri.id
  `).all(ids) as Array<{ recipe_id: number; name: string; product_group: string }>;
  for (const l of lines) {
    if (!ingredients.has(l.recipe_id)) ingredients.set(l.recipe_id, []);
    ingredients.get(l.recipe_id)!.push(l);
  }

  // The calendar weeks just before this one, newest first: what is better not repeated.
  // Not the latest menus: weeks planned ahead would push last week out
  const before = Array.from({ length: KADERS.recentWeeks }, (_, i) => shiftWeek(week, year, -(i + 1)));
  const recent = new Map<number, number[]>();
  const planned = db.prepare(`
    SELECT md.recipe_id, m.week_number FROM menu_days md JOIN menus m ON m.id = md.menu_id
    WHERE md.recipe_id IS NOT NULL AND m.year * 100 + m.week_number IN (SELECT value FROM json_each(?))
    ORDER BY m.year DESC, m.week_number DESC
  `).all(JSON.stringify(before.map((w) => w.year * 100 + w.week_number))) as Array<{ recipe_id: number; week_number: number }>;
  for (const p of planned) {
    const weeks = recent.get(p.recipe_id) ?? [];
    if (!weeks.includes(p.week_number)) weeks.push(p.week_number);
    recent.set(p.recipe_id, weeks);
  }

  const assessments = assessRecipes(db, rows.map((r) => r.id));
  return rows.map((r) => {
    const own = ingredients.get(r.id) ?? [];
    const assessment = assessments.get(r.id);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      meal_type: r.meal_type,
      prep_time_minutes: r.prep_time_minutes,
      cost_index: r.cost_index,
      protein: proteinTags(own),
      veg_per_serving: assessment?.veg.per_serving ?? 0,
      veg_exception: Boolean(r.veg_exception),
      meal_missing: assessment?.meal.missing ?? [],
      rating_avg: r.rating_avg,
      rating_count: r.rating_count,
      recent_weeks: recent.get(r.id) ?? [],
      last_used: r.last_used,
      recipe_image_version: r.image_version,
      ingredients: own.filter((i) => !['kruiden', 'olie'].includes(i.product_group)).map((i) => i.name).slice(0, 10),
    };
  });
}

/** The breakfasts or snacks the picker offers: approved, then concept. */
function plannerExtras(db: Database.Database, course: 'ontbijt' | 'snack'): PlannerExtra[] {
  return db.prepare(`
    SELECT id, name, status, prep_time_minutes, image_version AS recipe_image_version FROM recipes
    WHERE course = ? AND status IN ('goedgekeurd', 'concept')
    ORDER BY status = 'concept', name
  `).all(course) as PlannerExtra[];
}

/** Everything the picker needs to plan one week. */
export function plannerState(db: Database.Database, week: number, year: number): PlannerState {
  const menu = db.prepare('SELECT id, status, created_at FROM menus WHERE week_number = ? AND year = ?').get(week, year) as
    { id: number; status: string; created_at: string } | undefined;
  let existing: PlannerState['existing'] = null;
  if (menu) {
    const extras = db.prepare('SELECT kind, recipe_id FROM menu_extras WHERE menu_id = ? ORDER BY position').all(menu.id) as
      Array<{ kind: string; recipe_id: number }>;
    existing = {
      status: menu.status,
      // Stored by SQLite as UTC without a zone: "2026-10-28 10:05:00"
      saved_at: new Date(`${menu.created_at.replace(' ', 'T')}Z`).toISOString(),
      days: db.prepare('SELECT day_name, recipe_id FROM menu_days WHERE menu_id = ? ORDER BY day_of_week').all(menu.id) as
        Array<{ day_name: string; recipe_id: number | null }>,
      breakfasts: extras.filter((e) => e.kind === 'ontbijt').map((e) => e.recipe_id),
      snacks: extras.filter((e) => e.kind === 'snack').map((e) => e.recipe_id),
    };
  }
  const include = existing ? existing.days.map((d) => d.recipe_id).filter((id): id is number => id !== null) : [];
  return {
    configured: isModelConfigured(),
    week_number: week,
    year,
    previous: shiftWeek(week, year, -1),
    next: shiftWeek(week, year, 1),
    days: menuWeekDays(week, year),
    existing,
    recipes: plannerRecipes(db, week, year, include),
    breakfasts: plannerExtras(db, 'ontbijt'),
    snacks: plannerExtras(db, 'snack'),
    per_week: { breakfasts: BREAKFASTS_PER_WEEK, snacks: SNACKS_PER_WEEK },
    job: proposalJob(),
  };
}

const ProposalRequestSchema = z.object({
  week_number: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  days: z.array(z.object({
    day_name: z.enum(MENU_DAYS),
    recipe_id: z.number().int().positive().nullable(),
    free: z.boolean().optional(),
  })).min(1).max(7).refine((days) => new Set(days.map((d) => d.day_name)).size === days.length, 'elke dag één keer'),
  breakfasts: z.array(z.number().int().positive()).max(7).default([]),
  snacks: z.array(z.number().int().positive()).max(7).default([]),
  wishes: z.string().trim().max(1000).default(''),
});

/** A request from the picker, checked; zod messages become one readable error. */
export function parseProposalRequest(body: unknown): ProposalRequest {
  const result = ProposalRequestSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RecipeError(`${issue.path.join('.') || 'verzoek'}: ${issue.message}`);
  }
  if (!result.data.days.some((d) => d.recipe_id === null && !d.free)) {
    throw new RecipeError('Alle dagen zijn al gekozen');
  }
  return result.data;
}

export const MENU_SYSTEM_PROMPT = `Je stelt het avondeten van een week samen voor een Nederlands gezin (2 volwassenen en 2 kinderen), uit hun eigen bibliotheek met goedgekeurde recepten. De recepten staan al op 4 personen. De app controleert je keuze op de kaders hieronder en legt hem terug als hij er niet aan voldoet.

Kaders:
- Groente: elke avond minstens ${KADERS.vegetables.target} g groente per volwassene ("g groente" staat per recept). Een recept met "uitzondering" (zoals pizza) haalt minstens ${KADERS.vegetables.minimum} g met het bijgerecht en mag hooguit ${KADERS.exceptions.max}× per week.
- Hele maaltijd: geen recept met "mist koolhydraten" of "mist eiwit".
- Eiwit per week: minstens ${KADERS.fish.min}× vis, minstens ${KADERS.legumes.min}× peulvruchten, hooguit ${KADERS.meat.max}× vlees (liever ${KADERS.meat.preferred}×), de rest vegetarisch. Een recept met "vlees + peulvruchten" telt voor allebei.
- Tijd: doordeweeks (maandag tot en met vrijdag) liefst hooguit ${KADERS.weekdayMinutes} minuten; langere en ovengerechten in het weekend.
- Variatie: geen recept twee keer, liever niets dat "recent" gepland is, niet twee dagen achter elkaar dezelfde soort (pasta, rijst, soep…), elke soort hooguit ${KADERS.sameKindMax}× per week, en niet kort achter elkaar dezelfde hoofdgroente.
- Smaak: recepten met veel sterren mogen vaker terug; lage beoordelingen en de opmerkingen van het gezin neem je serieus. Kies wat bij het seizoen past.

Kies alleen recepten uit de lijst, met hun #nummer. Dagen die al vaststaan tellen mee voor de kaders; die kies je niet opnieuw.

Antwoord met ALLEEN dit JSON-object, zonder uitleg en zonder markdown:
{"days": [{"day_name": "Donderdag", "recipe_id": 12}], "breakfasts": [31], "snacks": [41], "toelichting": "Twee of drie zinnen: hoe de week in balans is en welke wensen of feedback je verwerkte."}
Geef in "days" alleen de dagen die je moet kiezen. Laat "breakfasts" en "snacks" leeg als er niet om gevraagd wordt.`;

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** "Donderdag 5 november". */
function dayLabel(day: { day_name: string; date: string | null }): string {
  if (!day.date) return day.day_name;
  const [, m, d] = day.date.split('-').map(Number);
  return `${day.day_name} ${d} ${MONTHS[m - 1]}`;
}

/** One dinner as the model reads it: "#12 Linzensoep — soep · 30 min · € · peulvruchten · 380 g groente · 4,5 sterren (3×)". */
export function recipeLine(r: PlannerRecipe): string {
  const meta = [
    r.meal_type,
    r.prep_time_minutes ? `${r.prep_time_minutes} min` : null,
    r.cost_index,
    r.protein.length ? r.protein.join(' + ') : 'vega',
    `${r.veg_per_serving} g groente${r.veg_exception ? ' (uitzondering)' : ''}`,
    r.meal_missing.length ? `mist ${r.meal_missing.join(' en ')}` : null,
    r.rating_count ? `${formatStars(r.rating_avg!)} sterren (${r.rating_count}×)` : null,
    r.recent_weeks.length ? `recent (week ${r.recent_weeks.join(', ')})` : null,
  ].filter(Boolean).join(' · ');
  return `#${r.id} ${r.name} — ${meta}`;
}

/** The user message: the week, what is fixed and open, the wishes, and the library. */
export function proposalPrompt(
  db: Database.Database,
  request: ProposalRequest,
  dates: Map<string, string>,
  recipes: PlannerRecipe[],
  extras: { breakfasts: PlannerExtra[]; snacks: PlannerExtra[] },
): string {
  const lookup = new Map(recipes.map((r) => [r.id, r]));
  const days = request.days.map((d) => ({ ...d, date: dates.get(d.day_name) ?? null }));
  const open = days.filter((d) => d.recipe_id === null && !d.free);
  const fixed = days.filter((d) => d.recipe_id !== null && !d.free);
  const free = days.filter((d) => d.free);
  const first = days.find((d) => d.date)?.date;

  const lines = [
    `Week ${request.week_number}${first ? `, ${MONTHS[Number(first.split('-')[1]) - 1]} ${request.year}` : ''}.`,
    '',
    `Kies een recept voor: ${open.map((d) => `${dayLabel(d)} (${['Zaterdag', 'Zondag'].includes(d.day_name) ? 'weekend' : 'doordeweeks'})`).join(', ')}.`,
  ];
  if (fixed.length) {
    lines.push('', 'Staat al vast:');
    for (const d of fixed) {
      const r = lookup.get(d.recipe_id!);
      lines.push(`- ${d.day_name}: ${r ? recipeLine(r) : `#${d.recipe_id}`}`);
    }
  }
  if (free.length) lines.push('', `Geen avondeten nodig op: ${free.map((d) => d.day_name).join(', ')}.`);
  if (request.wishes) lines.push('', `Wensen van het gezin voor deze week: ${request.wishes}`);

  lines.push('', '## Goedgekeurde recepten', '');
  for (const r of recipes.filter((r) => r.status === 'goedgekeurd')) {
    lines.push(recipeLine(r));
    if (r.ingredients.length) lines.push(`   ${r.ingredients.slice(0, 8).join(', ')}`);
  }

  const notes = familyNotes(db);
  if (notes.length) {
    lines.push('', '## Opmerkingen van het gezin', '');
    for (const n of notes) lines.push(`- ${n.recipe_name} (${n.stars}/5): "${n.notes.trim()}"`);
  }

  const askExtras: Array<[string, PlannerExtra[], number]> = [];
  if (!request.breakfasts.length && extras.breakfasts.length) askExtras.push(['Ontbijt', extras.breakfasts, BREAKFASTS_PER_WEEK]);
  if (!request.snacks.length && extras.snacks.length) askExtras.push(['Gezonde tussendoortjes', extras.snacks, SNACKS_PER_WEEK]);
  for (const [title, list, perWeek] of askExtras) {
    lines.push('', `## ${title} (kies er ${perWeek})`, '');
    for (const e of list) lines.push(`#${e.id} ${e.name}${e.status === 'concept' ? ' (nog niet geprobeerd)' : ''}`);
  }
  return lines.join('\n');
}

const recipeId = z.preprocess((v) => (typeof v === 'string' ? Number(v.trim().replace(/^#/, '')) : v), z.number().int());
// An extra may come as {"recipe_id": 31} rather than its number
const extraId = z.preprocess(
  (v) => (v && typeof v === 'object' && 'recipe_id' in v ? (v as { recipe_id: unknown }).recipe_id : v), recipeId);

/** What the model returns; lenient where the app can still tell what was meant. */
const AnswerSchema = z.object({
  days: z.array(z.object({ day_name: z.string(), recipe_id: recipeId.nullish() })),
  breakfasts: z.array(extraId).default([]).catch([]),
  snacks: z.array(extraId).default([]).catch([]),
  toelichting: z.string().default('').catch(''),
});

/** An answer that cannot be used at all, with the reason the next attempt is told. */
class Rejected extends Error {}

interface Candidate {
  days: DraftDay[];
  breakfasts: number[];
  snacks: number[];
  note: string;
  /** Days the model left open or filled with something not on the list. */
  issues: string[];
}

/** The model's days on the open days of the request; what it got wrong becomes an issue. */
export function readAnswer(
  content: string,
  request: ProposalRequest,
  dates: Map<string, string>,
  approved: Set<number>,
  extras: { breakfasts: PlannerExtra[]; snacks: PlannerExtra[] },
): Candidate {
  let json: unknown;
  try { json = extractJson(content); } catch { throw new Rejected('het antwoord was geen geldig JSON-object'); }
  const parsed = AnswerSchema.safeParse(json);
  if (!parsed.success) throw new Rejected('het antwoord had niet het gevraagde formaat');
  const given = new Map(parsed.data.days.map((d) => [d.day_name.trim().toLowerCase(), d.recipe_id ?? null]));

  const issues: string[] = [];
  const days: DraftDay[] = request.days.map((d) => {
    const day: DraftDay = { day_name: d.day_name, date: dates.get(d.day_name) ?? null, recipe_id: d.recipe_id, free: d.free };
    if (d.free || d.recipe_id !== null) return day;
    const id = given.get(d.day_name.toLowerCase());
    if (id === undefined || id === null) issues.push(`${d.day_name}: geen recept gekozen`);
    else if (!approved.has(id)) issues.push(`${d.day_name}: #${id} staat niet in de lijst`);
    else day.recipe_id = id;
    return day;
  });

  /** The chosen ones if any, else what the model picked from the list, once each, as many as a week has. */
  const pick = (chosen: number[], proposed: number[], list: PlannerExtra[], perWeek: number) => {
    if (chosen.length) return chosen;
    const known = new Set(list.map((e) => e.id));
    return [...new Set(proposed.filter((id) => known.has(id)))].slice(0, perWeek);
  };
  return {
    days,
    breakfasts: pick(request.breakfasts, parsed.data.breakfasts, extras.breakfasts, BREAKFASTS_PER_WEEK),
    snacks: pick(request.snacks, parsed.data.snacks, extras.snacks, SNACKS_PER_WEEK),
    note: parsed.data.toelichting.trim(),
    issues,
  };
}

/** The follow-up when a week does not keep to the rules. */
export function retryPrompt(fails: string[], warnings: string[]): string {
  return [
    'De app keurde dit menu af, omdat het niet aan de kaders voldoet:',
    ...fails.map((f) => `- ${f}`),
    ...(warnings.length ? ['', 'Liever ook anders, als het kan:', ...warnings.map((w) => `- ${w}`)] : []),
    '',
    'Pas het menu aan en geef het hele JSON-object opnieuw.',
  ].join('\n');
}

// Not tested in a bake-off yet; glm reasons before it answers, which a week of
// rules needs, and did best at keeping recipes recognisable (vegetable top-up).
// The fallback is the proxy's general backstop.
const PRIMARY = process.env.MENU_MODEL || 'cloud-glm';
const FALLBACK = process.env.MENU_FALLBACK_MODEL || 'cloud-kimi';
/** Attempts in order; each after the first sees the earlier answer and what was wrong with it. */
export const MENU_ATTEMPTS: Array<{ model: string; maxTokens: number }> = [
  { model: PRIMARY, maxTokens: 16000 },
  { model: PRIMARY, maxTokens: 32000 },
  { model: FALLBACK, maxTokens: 16000 },
];
// Some room to vary, so asking again gives another week
const TEMPERATURE = 0.5;

let job: ProposalJob = idle();

function idle(): ProposalJob {
  return {
    running: false, started_at: null, finished_at: null, week_number: null, year: null,
    attempt: 0, attempts: MENU_ATTEMPTS.length, model: null, proposal: null, error: null,
  };
}

export function proposalJob(): ProposalJob {
  return structuredClone(job);
}

/**
 * Have a model propose the open days of `request`. Returns false when a
 * proposal is running already; otherwise the run's promise, which the route
 * does not wait for: a reasoning model takes minutes, longer than the reverse
 * proxy waits. The picker polls proposalJob().
 */
export function startProposal(db: Database.Database, request: ProposalRequest, call: ModelCall = callModel): false | Promise<void> {
  if (job.running) return false;
  job = { ...idle(), running: true, started_at: new Date().toISOString(), week_number: request.week_number, year: request.year };

  const run = async () => {
    const dates = new Map(menuWeekDays(request.week_number, request.year).map((d) => [d.day_name, d.date]));
    const fixed = request.days.map((d) => d.recipe_id).filter((id): id is number => id !== null);
    const recipes = plannerRecipes(db, request.week_number, request.year, fixed);
    const lookup: RecipeLookup = new Map(recipes.map((r) => [r.id, r]));
    const approved = new Set(recipes.filter((r) => r.status === 'goedgekeurd').map((r) => r.id));
    const extras = { breakfasts: plannerExtras(db, 'ontbijt'), snacks: plannerExtras(db, 'snack') };
    if (approved.size === 0) throw new RecipeError('Er zijn nog geen goedgekeurde hoofdgerechten om uit te kiezen', 422);

    const messages: ChatMessage[] = [
      { role: 'system', content: MENU_SYSTEM_PROMPT },
      { role: 'user', content: proposalPrompt(db, request, dates, recipes, extras) },
    ];
    let best: (MenuProposal & { score: number }) | null = null;
    let reason = '';
    for (const [n, { model, maxTokens }] of MENU_ATTEMPTS.entries()) {
      job.attempt = n + 1;
      job.model = model;
      let content: string;
      try {
        content = await call(model, messages, maxTokens, TEMPERATURE);
      } catch (err) {
        if (err instanceof RecipeError && err.status === 503) throw err; // not configured or unreachable
        reason = (err as Error).message;
        console.warn(`Menuvoorstel via ${model} mislukt: ${reason}`);
        continue;
      }
      try {
        const candidate = readAnswer(content, request, dates, approved, extras);
        const { fails, warnings } = problemsOf(checkMenu(candidate.days, lookup), candidate.days);
        fails.unshift(...candidate.issues);
        // Rules broken weigh far more than preferences missed
        const score = fails.length * 100 + warnings.length;
        if (!best || score < best.score) {
          best = {
            days: candidate.days, breakfasts: candidate.breakfasts, snacks: candidate.snacks,
            note: candidate.note, model, fails, warnings, score,
          };
        }
        if (fails.length === 0) break;
        reason = fails.join('; ');
        messages.push({ role: 'assistant', content }, { role: 'user', content: retryPrompt(fails, warnings) });
      } catch (err) {
        if (!(err instanceof Rejected)) throw err;
        reason = err.message;
        console.warn(`Menuvoorstel via ${model} afgewezen: ${reason}`);
        messages.push(
          { role: 'assistant', content },
          { role: 'user', content: `Dat kon de app niet gebruiken: ${reason}. Antwoord met alleen het JSON-object.` },
        );
      }
    }
    if (!best) throw new RecipeError(`Het taalmodel gaf geen bruikbaar menu${reason ? ` (${reason})` : ''}`, 502);
    const { score: _score, ...proposal } = best;
    job.proposal = proposal;
  };

  return run()
    .catch((err) => {
      job.error = (err as Error).message;
      if (!(err instanceof RecipeError)) console.error('Menuvoorstel mislukt:', err);
    })
    .finally(() => {
      job.running = false;
      job.finished_at = new Date().toISOString();
    });
}
