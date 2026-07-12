import dns from 'dns';
import { z } from 'zod';
import { parseIngredientLine, PRODUCT_GROUPS, RawIngredient } from './ingredients.js';

const FETCH_TIMEOUT_MS = 10_000;
const LLM_TIMEOUT_MS = 60_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const MAX_LLM_INPUT_CHARS = 15_000;

// Pretend to be a desktop browser: many recipe sites 403 the default UA
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export interface RecipeDraft {
  name: string;
  source: string;
  recipe_data: {
    servings: number;
    ingredients: RawIngredient[];
    steps: string[];
    nutrition_per_serving: { calories: number; protein_g: number; fiber_g: number; iron_mg: number };
    tip?: string;
  };
  tags: string[];
  warnings: string[];
  method: 'jsonld' | 'llm';
}

/** True for addresses that server-side fetch must never reach (SSRF guard). */
export function isBlockedAddress(hostnameOrIp: string): boolean {
  const h = hostnameOrIp.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv6
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;          // fc00::/7
    if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // fe80::/10
    const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);            // IPv4-mapped
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }

  // IPv4
  const parts = h.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false; // hostname, not an IP
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, includes Tailscale
  return false;
}

async function assertAllowedHost(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Alleen http(s) URLs zijn toegestaan');
  }
  if (isBlockedAddress(url.hostname)) {
    throw new Error('Deze URL is niet toegestaan');
  }
  // Resolve and check every address. Note: a DNS-rebinding window remains
  // between this lookup and the actual fetch — accepted residual risk for a
  // single-user app behind auth.
  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(url.hostname, { all: true });
  } catch {
    throw new Error('URL kon niet worden opgehaald');
  }
  if (addresses.some((addr) => isBlockedAddress(addr.address))) {
    throw new Error('Deze URL is niet toegestaan');
  }
}

/** Fetch a page with SSRF guard, manual redirects, timeout and size cap. */
export async function fetchPage(url: string): Promise<string> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new Error('Ongeldige URL');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertAllowedHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      });
    } catch {
      throw new Error('URL kon niet worden opgehaald');
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('URL kon niet worden opgehaald');
      current = new URL(location, current);
      continue;
    }
    if (!res.ok) {
      throw new Error(`URL kon niet worden opgehaald (status ${res.status})`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/ld+json')) {
      throw new Error('Pagina is geen HTML');
    }
    const contentLength = Number(res.headers.get('content-length'));
    if (contentLength > MAX_PAGE_BYTES) {
      throw new Error('Pagina is te groot');
    }

    // Stream with a hard cap; content-length can lie or be absent
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error('Pagina is te groot');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
  throw new Error('Te veel redirects');
}

type JsonObject = Record<string, unknown>;

function isRecipeNode(node: unknown): node is JsonObject {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const type = (node as JsonObject)['@type'];
  if (typeof type === 'string') return type === 'Recipe';
  if (Array.isArray(type)) return type.includes('Recipe');
  return false;
}

/** Find the first schema.org/Recipe node in the page's JSON-LD blocks. */
export function extractJsonLdRecipe(html: string): JsonObject | null {
  const scriptRe = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRe.exec(html)) !== null) {
    let raw = match[1].trim();
    // Some sites wrap the JSON in CDATA or HTML comments
    raw = raw.replace(/^<!--/, '').replace(/-->$/, '');
    raw = raw.replace(/^\/\*<!\[CDATA\[\*\//, '').replace(/\/\*\]\]>\*\/$/, '').trim();

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue; // malformed block: try the next one
    }

    const candidates: unknown[] = Array.isArray(data) ? data : [data];
    for (const candidate of candidates) {
      if (isRecipeNode(candidate)) return candidate;
      if (candidate && typeof candidate === 'object') {
        const graph = (candidate as JsonObject)['@graph'];
        if (Array.isArray(graph)) {
          const recipe = graph.find(isRecipeNode);
          if (recipe) return recipe as JsonObject;
        }
      }
    }
  }
  return null;
}

const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&eacute;': 'é', '&egrave;': 'è', '&euml;': 'ë', '&iuml;': 'ï', '&ouml;': 'ö',
  '&uuml;': 'ü', '&agrave;': 'à', '&ccedil;': 'ç', '&nbsp;': ' ',
};

function cleanText(value: string): string {
  let s = value.replace(/<[^>]*>/g, ' ');
  for (const [entity, char] of Object.entries(ENTITY_MAP)) {
    s = s.split(entity).join(char);
  }
  s = s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return s.replace(/\s+/g, ' ').trim();
}

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

function extractSteps(instructions: unknown): string[] {
  if (typeof instructions === 'string') {
    return instructions.split(/\n+/).map(cleanText).filter(Boolean);
  }
  if (!Array.isArray(instructions)) return [];

  const steps: string[] = [];
  for (const item of instructions) {
    if (typeof item === 'string') {
      const text = cleanText(item);
      if (text) steps.push(text);
    } else if (item && typeof item === 'object') {
      const obj = item as JsonObject;
      if (obj['@type'] === 'HowToSection' && Array.isArray(obj.itemListElement)) {
        steps.push(...extractSteps(obj.itemListElement));
      } else if (typeof obj.text === 'string') {
        const text = cleanText(obj.text);
        if (text) steps.push(text);
      }
    }
  }
  return steps;
}

function parseLeadingNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : 0;
}

/** Map a schema.org/Recipe node onto the app's RecipeData shape. */
export function mapSchemaRecipeToDraft(node: JsonObject, url: string): Omit<RecipeDraft, 'method'> {
  const warnings: string[] = [];

  const name = typeof node.name === 'string' ? cleanText(node.name).slice(0, 200) : '';
  if (!name) warnings.push('Geen naam gevonden — vul zelf een naam in');

  const yieldValues = asStringArray(node.recipeYield);
  let servings = 4;
  const yieldNum = typeof node.recipeYield === 'number'
    ? node.recipeYield
    : parseLeadingNumber(yieldValues[0]);
  if (yieldNum >= 1 && yieldNum <= 20) servings = Math.round(yieldNum);

  const ingredients = asStringArray(node.recipeIngredient).map((line) => parseIngredientLine(cleanText(line)));
  if (ingredients.length === 0) warnings.push('Geen ingrediënten gevonden');

  const steps = extractSteps(node.recipeInstructions);
  if (steps.length === 0) warnings.push('Geen bereidingsstappen gevonden');

  let nutrition = { calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 };
  if (node.nutrition && typeof node.nutrition === 'object') {
    const n = node.nutrition as JsonObject;
    nutrition = {
      calories: parseLeadingNumber(n.calories),
      protein_g: parseLeadingNumber(n.proteinContent),
      fiber_g: parseLeadingNumber(n.fiberContent),
      iron_mg: 0, // schema.org almost never carries iron
    };
  }
  if (nutrition.calories === 0) {
    warnings.push('Voedingswaarden niet gevonden — vul zelf aan');
  }

  const tags = [
    ...asStringArray(node.keywords).flatMap((k) => k.split(',')),
    ...asStringArray(node.recipeCategory),
    ...asStringArray(node.recipeCuisine),
  ]
    .map((t) => cleanText(t).toLowerCase())
    .filter(Boolean);

  return {
    name,
    source: url,
    recipe_data: { servings, ingredients, steps, nutrition_per_serving: nutrition },
    tags: Array.from(new Set(tags)).slice(0, 6),
    warnings,
  };
}

const LlmDraftSchema = z.object({
  name: z.string().min(1).max(200),
  servings: z.number().int().min(1).max(20).catch(4),
  ingredients: z.array(z.object({
    name: z.string(),
    amount: z.union([z.string(), z.number()]).catch(''),
    unit: z.string().catch(''),
    product_group: z.string().catch('overig'),
  })).min(1),
  steps: z.array(z.string()).min(1),
  nutrition_per_serving: z.object({
    calories: z.number().catch(0),
    protein_g: z.number().catch(0),
    fiber_g: z.number().catch(0),
    iron_mg: z.number().catch(0),
  }).catch({ calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 }),
  tags: z.array(z.string()).catch([]),
});

/** Strip markdown code fences and surrounding prose from LLM JSON output. */
export function stripJsonFence(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```(?:json|JSON)?\s*\n?/, '');
  s = s.replace(/\n?```\s*$/, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return s.trim();
}

/** Reduce an HTML page to readable text for the LLM prompt. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LLM_INPUT_CHARS);
}

/** Extract a recipe from arbitrary page text via the LiteLLM proxy. */
export async function extractRecipeViaLlm(html: string, url: string): Promise<Omit<RecipeDraft, 'method'>> {
  const baseUrl = process.env.LITELLM_URL;
  const apiKey = process.env.LITELLM_MASTER_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('Geen recept gevonden op deze pagina (LLM-fallback niet geconfigureerd)');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.LITELLM_MODEL || 'cloud-kimi',
        max_tokens: 8000,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `Je haalt een recept uit webpagina-tekst. Antwoord met ALLEEN een JSON-object, zonder uitleg, in exact dit formaat:
{"name": "...", "servings": 4, "ingredients": [{"name": "...", "amount": "...", "unit": "...", "product_group": "..."}], "steps": ["..."], "nutrition_per_serving": {"calories": 0, "protein_g": 0, "fiber_g": 0, "iron_mg": 0}, "tags": ["..."]}
product_group moet één van deze zijn: ${PRODUCT_GROUPS.join(', ')}. Alles in het Nederlands. Als er geen recept op de pagina staat, antwoord {"error": "geen recept"}.`,
          },
          { role: 'user', content: htmlToText(html) },
        ],
      }),
    });
  } catch {
    throw new Error('LLM-fallback niet bereikbaar');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error('LLM kon geen recept uit deze pagina halen');
  }

  const body = await res.json() as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string; reasoning?: string } }>;
  };
  const message = body.choices?.[0]?.message;
  // Reasoning models can burn the whole budget on thinking and leave content empty
  const content = message?.content?.trim() || message?.reasoning_content?.trim() || message?.reasoning?.trim() || '';
  if (!content) {
    throw new Error('LLM kon geen recept uit deze pagina halen');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error('LLM kon geen recept uit deze pagina halen');
  }

  const draft = LlmDraftSchema.safeParse(parsed);
  if (!draft.success) {
    throw new Error('LLM kon geen recept uit deze pagina halen');
  }

  const d = draft.data;
  return {
    name: d.name,
    source: url,
    recipe_data: {
      servings: d.servings,
      ingredients: d.ingredients.map((ing) => ({
        ...ing,
        product_group: PRODUCT_GROUPS.includes(ing.product_group) ? ing.product_group : 'overig',
      })),
      steps: d.steps,
      nutrition_per_serving: d.nutrition_per_serving,
    },
    tags: d.tags.slice(0, 6),
    warnings: ['Geëxtraheerd door AI — controleer de ingrediënten en stappen'],
  };
}

/**
 * Import a recipe from a URL: schema.org JSON-LD first, LLM fallback for
 * pages without usable structured data. Returns a draft for human review.
 */
export async function importRecipeFromUrl(url: string): Promise<RecipeDraft> {
  const html = await fetchPage(url);

  const node = extractJsonLdRecipe(html);
  let jsonLdDraft: Omit<RecipeDraft, 'method'> | null = null;
  if (node) {
    jsonLdDraft = mapSchemaRecipeToDraft(node, url);
    const complete = jsonLdDraft.recipe_data.ingredients.length > 0 && jsonLdDraft.recipe_data.steps.length > 0;
    if (complete) {
      return { ...jsonLdDraft, method: 'jsonld' };
    }
  }

  try {
    const llmDraft = await extractRecipeViaLlm(html, url);
    return { ...llmDraft, method: 'llm' };
  } catch (err) {
    // A partial JSON-LD result beats a hard error: the form lets Han fix it
    if (jsonLdDraft && (jsonLdDraft.recipe_data.ingredients.length > 0 || jsonLdDraft.recipe_data.steps.length > 0)) {
      return { ...jsonLdDraft, method: 'jsonld' };
    }
    throw err;
  }
}
