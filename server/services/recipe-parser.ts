import { z } from 'zod';
import type Database from 'better-sqlite3';
import { RecipeError, getRecipe, parseRecipeInput, saveRecipe } from './recipes.js';

// Shared LiteLLM proxy (http://litellm:4000 from containers on personal_net)
const LITELLM_URL = process.env.LITELLM_URL;
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
// Bake-off (2026-09-29, 4 recipes): gemma was fastest (3-5 s), cheapest and did
// not invent amounts; mistral invented amounts, kimi took 2-3 minutes.
const RECIPE_PARSE_MODEL = process.env.RECIPE_PARSE_MODEL || 'cloud-gemma';
// Below the ~60 s read timeout of the reverse proxy, so a slow fallback model
// ends in a clear error instead of a dropped connection
const TIMEOUT_MS = 55_000;
export const MAX_RECIPE_TEXT = 20_000;

export const PARSE_SYSTEM_PROMPT = `Je zet een recept (vrije tekst, Nederlands of een andere taal) om naar JSON voor een Nederlandse maaltijdplanner. Antwoord met ALLEEN het JSON-object, zonder uitleg en zonder markdown.

Formaat:
{
  "name": "naam van het gerecht, in het Nederlands",
  "servings": 4,
  "meal_type": "pasta | rijst | wrap | oven | salade | soep | stamppot | overig",
  "prep_time_minutes": 30,
  "ingredients": [
    {"name": "ui", "amount": 2, "unit": "stuks", "product_group": "groenten", "note": "gesnipperd"}
  ],
  "steps": ["Stap 1", "Stap 2"],
  "tip": null,
  "nutrition_per_serving": {"calories": 450, "protein_g": 25, "fiber_g": 8, "iron_mg": 3}
}

Regels voor ingrediënten:
- name: de Nederlandse productnaam in enkelvoud zoals je hem koopt ("ui", "tomaat", "kikkererwten"), zonder bereiding, hoeveelheid of woorden als "vers" en "groot". Houd woorden die een ander product aanduiden wel ("rode ui", "gerookte paprika", "geraspte kaas"). Bereiding en opmerkingen ("gesnipperd", "in blokjes", "uitgelekt", "voor erbij") gaan in note.
- Blik, pot of diepvries hoort bij het product: "kikkererwten uit blik", "diepvries spinazie".
- amount: een getal, zoals in het recept (niet omrekenen naar andere porties). Breuken en bereiken omzetten: "½" = 0.5, "1-2" = 2. Bij "naar smaak" of als het recept geen hoeveelheid noemt: null; verzin geen hoeveelheid.
- unit: alleen een van: g, ml, el, tl, stuks, teen, blik, pot, zak, bos, plak, snufje, takje, krop, bakje. Reken kg om naar g en dl of l naar ml. Losse stuks: "stuks". Zonder hoeveelheid: "".
- product_group: een van groenten, fruit, vis, vlees, zuivel, brood, droogwaren, kruiden, olie, sauzen, diepvries, overig.
- Neem alle ingrediënten uit het recept over en verzin er geen bij.

Overig:
- servings: het aantal personen uit het recept; staat het er niet, gebruik 4.
- prep_time_minutes: totale bereidingstijd als getal; schat hem als het recept hem niet noemt.
- steps: korte, duidelijke stappen in het Nederlands.
- tip: een tip uit het recept of null.
- nutrition_per_serving: een redelijke schatting per portie.`;

const num = z.union([z.number(), z.string()]).transform((v) => (typeof v === 'number' ? v : parseFloat(v.replace(',', '.'))));

/** What the model returns; lenient, since the user reviews everything before saving. */
const ParsedRecipeSchema = z.object({
  name: z.string().default(''),
  servings: num.catch(4).transform((n) => (Number.isFinite(n) && n >= 1 ? Math.round(n) : 4)),
  meal_type: z.string().nullish().catch(null).transform((v) => v ?? null),
  prep_time_minutes: num.nullish().catch(null).transform((n) => (n != null && Number.isFinite(n) ? Math.round(n) : null)),
  ingredients: z.array(z.object({
    name: z.string(),
    amount: z.union([z.number(), z.string(), z.null()]).catch(null),
    unit: z.string().nullish().transform((u) => u ?? ''),
    product_group: z.string().nullish().transform((g) => g || 'overig'),
    note: z.string().nullish().catch(null).transform((v) => v ?? null),
  })).default([]),
  steps: z.array(z.string()).catch([]),
  tip: z.string().nullish().catch(null).transform((v) => v ?? null),
  nutrition_per_serving: z.object({
    calories: num, protein_g: num, fiber_g: num, iron_mg: num,
  }).nullish().catch(null).transform((v) => v ?? null),
});

export type ParsedRecipe = z.infer<typeof ParsedRecipeSchema>;

/** Pull the JSON object out of a reply that may be wrapped in fences or chatter. */
export function extractJson(reply: string): unknown {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new RecipeError('Het model gaf geen recept terug', 502);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new RecipeError('Het model gaf geen geldige JSON terug', 502);
  }
}

export function isParserConfigured(): boolean {
  return Boolean(LITELLM_URL && LITELLM_API_KEY);
}

/** Turn free recipe text into a structured draft via the LLM. Nothing is saved. */
export async function parseRecipeText(text: string): Promise<ParsedRecipe> {
  if (!isParserConfigured()) {
    throw new RecipeError('Recept-import is niet geconfigureerd (LITELLM_URL / LITELLM_API_KEY)', 503);
  }

  let response: Response;
  try {
    response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LITELLM_API_KEY}` },
      body: JSON.stringify({
        model: RECIPE_PARSE_MODEL,
        temperature: 0.1,
        max_tokens: 8000,
        messages: [
          { role: 'system', content: PARSE_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new RecipeError(timedOut ? 'Het model deed er te lang over' : 'Kon het taalmodel niet bereiken', 502);
  }

  if (!response.ok) {
    console.error('Recipe parse failed:', response.status, (await response.text()).slice(0, 500));
    throw new RecipeError(`Het taalmodel gaf een fout (${response.status})`, 502);
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new RecipeError('Het model gaf een leeg antwoord', 502);

  const result = ParsedRecipeSchema.safeParse(extractJson(content));
  if (!result.success) throw new RecipeError('Het model gaf een onbruikbaar recept terug', 502);
  const recipe = result.data;
  recipe.ingredients = recipe.ingredients.filter((i) => i.name.trim());
  return recipe;
}

/**
 * Instructions for turning recipes into a JSON array the app can take in
 * without a model (e.g. by Claude in a project that holds the cookbooks):
 * the parser's own format, asked for as an array.
 */
export const BULK_JSON_INSTRUCTIONS = `Zet de recepten om naar JSON voor de Weekmenu-app: een JSON-array met per recept één object, zoals hieronder beschreven. Antwoord met ALLEEN de JSON-array, zonder uitleg en zonder markdown. Doe maximaal 10 recepten per antwoord; ik vraag om de volgende als ik klaar ben.
${PARSE_SYSTEM_PROMPT.replace(/^.*\n/, '')}`;

/**
 * Read one recipe's text with the model and store it as a concept, for bulk
 * imports. Falls back to the section title when the model found no name.
 */
export async function importRecipeText(
  db: Database.Database,
  text: string,
  options: { title?: string; source?: string } = {},
) {
  const draft = await parseRecipeText(text);
  if (draft.ingredients.length === 0) {
    throw new RecipeError('Geen ingrediënten gevonden', 422);
  }
  const input = parseRecipeInput({
    ...draft,
    name: draft.name.trim() || options.title?.trim() || '',
    status: 'concept',
    source: options.source?.slice(0, 50),
    steps: draft.steps.map((step) => step.trim()).filter(Boolean),
    prep_time_minutes: draft.prep_time_minutes !== null && draft.prep_time_minutes <= 1440 ? draft.prep_time_minutes : null,
  });
  const id = saveRecipe(db, input);
  return getRecipe(db, id);
}
