import { RecipeError } from './recipes.js';

/**
 * Chat completions through the shared LiteLLM proxy (http://litellm:4000 from
 * containers on personal_net), for the jobs that run in the background: the
 * vegetable top-up and the menu proposal. Not behind the reverse proxy's 60 s
 * timeout, so a reasoning model gets minutes.
 */

const LITELLM_URL = process.env.LITELLM_URL;
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const TIMEOUT_MS = 300_000;

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ModelCall = (model: string, messages: ChatMessage[], maxTokens: number, temperature?: number) => Promise<string>;

export function isModelConfigured(): boolean {
  return Boolean(LITELLM_URL && LITELLM_API_KEY);
}

/** One chat completion; the answer's content. */
export const callModel: ModelCall = async (model, messages, maxTokens, temperature = 0.2) => {
  if (!LITELLM_URL || !LITELLM_API_KEY) throw new RecipeError('Taalmodel niet geconfigureerd (LITELLM_URL / LITELLM_API_KEY)', 503);
  let response: Response;
  try {
    response = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LITELLM_API_KEY}` },
      // Reasoning models think before they answer: leave room for both
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    // A slow model: the next attempt may do better
    if ((err as Error).name === 'TimeoutError') throw err;
    // The proxy cannot be reached (a restart, the network): every next call would
    // fail the same way in a second, so a run stops instead of trying them all
    throw new RecipeError(`Taalmodel niet bereikbaar (${(err as Error).message})`, 503);
  }
  if (!response.ok) throw new Error(`${model} gaf een fout (${response.status})`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content?.trim()) throw new Error(`${model} gaf geen antwoord`);
  return content;
};
