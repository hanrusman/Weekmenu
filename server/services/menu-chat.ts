import type Database from 'better-sqlite3';
import { z } from 'zod';
import { CHECK_RANK, DraftDay, fitOf, MENU_DAYS, PlannerRecipe, RecipeLookup } from '../../shared/menu-rules.js';
import type { ChatReply, ChatRequest } from '../../shared/menu-planner.js';
import { plannerRecipes, recipeLine } from './menu-planner.js';
import { menuWeekDays } from './menu-generator.js';
import { familyNotes } from './planning.js';
import { extractJson } from './recipe-parser.js';
import { callModel, ChatMessage, ModelCall } from './llm.js';
import { RecipeError } from './recipes.js';

/**
 * The menu assistant: a conversation about one day of the week, in which a
 * model picks dinners from the library that suit a wish ("iets met pompoen",
 * "snel en zonder vlees"). It sees the library in order of how each dinner
 * fits the rest of the week, and may only answer with recipes from it; the
 * picker shows how each fits and the family chooses.
 */

// Someone waits for the answer, so a quick model rather than one that reasons for minutes:
// gemma was fastest (3-5 s) and kept to what was asked when reading recipes
const PRIMARY = process.env.MENU_CHAT_MODEL || 'cloud-gemma';
const FALLBACK = process.env.MENU_CHAT_FALLBACK_MODEL || 'cloud-mistral';
export const CHAT_ATTEMPTS = [PRIMARY, FALLBACK];
// Both attempts together stay below the reverse proxy's 60 s
const TIMEOUT_MS = 25_000;
const MAX_SUGGESTIONS = 3;

const ChatRequestSchema = z.object({
  week_number: z.number().int().min(1).max(53),
  year: z.number().int().min(2020).max(2100),
  day_name: z.enum(MENU_DAYS),
  days: z.array(z.object({
    day_name: z.enum(MENU_DAYS),
    recipe_id: z.number().int().positive().nullable(),
    free: z.boolean().optional(),
  })).min(1).max(7),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(1000),
    suggestions: z.array(z.number().int().positive()).max(5).optional(),
  })).min(1).max(20),
});

/** A request from the picker, checked; zod messages become one readable error. */
export function parseChatRequest(body: unknown): ChatRequest {
  const result = ChatRequestSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RecipeError(`${issue.path.join('.') || 'verzoek'}: ${issue.message}`);
  }
  const request = result.data;
  if (!request.days.some((d) => d.day_name === request.day_name)) throw new RecipeError('Die dag hoort niet bij de week');
  if (request.messages[request.messages.length - 1].role !== 'user') throw new RecipeError('Er is geen vraag om te beantwoorden');
  return request;
}

export const CHAT_SYSTEM_PROMPT = `Je helpt een Nederlands gezin (2 volwassenen en 2 kinderen) kiezen wat ze eten, uit hun eigen receptenbibliotheek. Ze vertellen wat ze zoeken; jij kiest er één tot drie uit de lijst die daar het best bij passen, met hun #nummer.

De lijst staat op volgorde van hoe goed een recept in de week past volgens de kaders van het gezin (groente, vis, peulvruchten, vlees, afwisseling, doordeweeks snel). Bij elk recept staat "past", of wat er dan misgaat. Kies wat past, tenzij de wens om iets anders vraagt; zeg dan eerlijk wat er misgaat.

Verzin geen recepten: alleen wat in de lijst staat. Past er niets bij de wens, zeg dat en laat "voorstellen" leeg.

Antwoord met ALLEEN dit JSON-object, zonder uitleg en zonder markdown:
{"antwoord": "Kort en vriendelijk, één tot drie zinnen.", "voorstellen": [{"recipe_id": 12, "waarom": "een korte reden"}]}`;

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

/** The day, the rest of the week and the library in order of fit, as the model reads them. */
export function chatContext(
  db: Database.Database, request: ChatRequest, recipes: PlannerRecipe[], dates: Map<string, string>,
): { text: string; candidates: Set<number> } {
  const lookup: RecipeLookup = new Map(recipes.map((r) => [r.id, r]));
  const days: DraftDay[] = request.days.map((d) => ({ ...d, date: dates.get(d.day_name) ?? null }));
  const index = days.findIndex((d) => d.day_name === request.day_name);
  const date = days[index].date;
  const label = date ? `${request.day_name} ${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}` : request.day_name;
  const weekend = ['Zaterdag', 'Zondag'].includes(request.day_name);

  const lines = [`Het gaat om ${label} (${weekend ? 'weekend' : 'doordeweeks'}), week ${request.week_number}.`, '', 'De rest van de week:'];
  for (const d of days) {
    if (d.day_name === request.day_name) continue;
    const r = d.recipe_id !== null ? lookup.get(d.recipe_id) : undefined;
    lines.push(`- ${d.day_name}: ${d.free ? 'geen avondeten' : r ? r.name : 'nog niets gekozen'}`);
  }

  const approved = recipes.filter((r) => r.status === 'goedgekeurd');
  const ranked = approved
    .map((r) => ({ r, fit: fitOf(days, index, r, lookup) }))
    .sort((a, b) => CHECK_RANK[a.fit.state] - CHECK_RANK[b.fit.state] || (b.r.rating_avg ?? 0) - (a.r.rating_avg ?? 0));
  lines.push('', '## Recepten', '');
  for (const { r, fit } of ranked) {
    const how = fit.state === 'ok' ? 'past' : fit.problems.map((p) => p.detail).join('; ');
    lines.push(`${recipeLine(r)} · ${how}`);
    if (r.ingredients.length) lines.push(`   ${r.ingredients.slice(0, 8).join(', ')}`);
  }

  const notes = familyNotes(db, 10);
  if (notes.length) {
    lines.push('', '## Opmerkingen van het gezin', '');
    for (const n of notes) lines.push(`- ${n.recipe_name} (${n.stars}/5): "${n.notes.trim()}"`);
  }
  return { text: lines.join('\n'), candidates: new Set(approved.map((r) => r.id)) };
}

const recipeId = z.preprocess((v) => (typeof v === 'string' ? Number(v.trim().replace(/^#/, '')) : v), z.number().int());

/** What the model returns; lenient where the app can still tell what was meant. */
const AnswerSchema = z.object({
  antwoord: z.string().default(''),
  voorstellen: z.array(z.object({ recipe_id: recipeId, waarom: z.string().default('').catch('') }).passthrough())
    .default([]).catch([]),
});

/** The model's answer, keeping only recipes from the list, each once. Null when it is no answer at all. */
export function readChatAnswer(content: string, candidates: Set<number>): Omit<ChatReply, 'model'> | null {
  let json: unknown;
  try { json = extractJson(content); } catch { return null; }
  const parsed = AnswerSchema.safeParse(json);
  if (!parsed.success) return null;
  const seen = new Set<number>();
  const suggestions = parsed.data.voorstellen
    .filter((s) => candidates.has(s.recipe_id) && !seen.has(s.recipe_id) && seen.add(s.recipe_id))
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => ({ recipe_id: s.recipe_id, reason: s.waarom.trim().slice(0, 300) }));
  const reply = parsed.data.antwoord.trim().slice(0, 800);
  if (!reply && suggestions.length === 0) return null;
  return { reply, suggestions };
}

/** Answer the last question about a day: the model's reply and the dinners it proposes. */
export async function chatAboutDay(db: Database.Database, request: ChatRequest, call: ModelCall = callModel): Promise<ChatReply> {
  const dates = new Map(menuWeekDays(request.week_number, request.year).map((d) => [d.day_name, d.date]));
  const fixed = request.days.map((d) => d.recipe_id).filter((id): id is number => id !== null);
  const recipes = plannerRecipes(db, request.week_number, request.year, fixed);
  const { text, candidates } = chatContext(db, request, recipes, dates);
  if (candidates.size === 0) throw new RecipeError('Er zijn nog geen goedgekeurde hoofdgerechten om uit te kiezen', 422);

  const messages: ChatMessage[] = [
    { role: 'system', content: `${CHAT_SYSTEM_PROMPT}\n\n${text}` },
    // Earlier answers as the model gave them, so it keeps to the format and knows what it proposed
    ...request.messages.map((m): ChatMessage => (m.role === 'user'
      ? { role: 'user', content: m.content }
      : { role: 'assistant', content: JSON.stringify({ antwoord: m.content, voorstellen: (m.suggestions ?? []).map((id) => ({ recipe_id: id })) }) })),
  ];
  let reason = '';
  for (const model of CHAT_ATTEMPTS) {
    try {
      const answer = readChatAnswer(await call(model, messages, 4000, { temperature: 0.4, timeoutMs: TIMEOUT_MS }), candidates);
      if (answer) return { ...answer, model };
      reason = 'geen bruikbaar antwoord';
    } catch (err) {
      if (err instanceof RecipeError && err.status === 503) throw err; // not configured or unreachable
      reason = (err as Error).name === 'TimeoutError' ? 'het duurde te lang' : (err as Error).message;
    }
    console.warn(`Menu-assistent via ${model}: ${reason}`);
  }
  throw new RecipeError(`De assistent gaf geen antwoord (${reason}); probeer het nog eens`, 502);
}
