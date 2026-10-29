// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.DATABASE_PATH = ':memory:';
const llm = vi.hoisted(() => ({ isModelConfigured: vi.fn(), callModel: vi.fn() }));
vi.mock('../server/services/llm', () => llm);
const planner = vi.hoisted(() => ({ startProposal: vi.fn() }));
vi.mock('../server/services/menu-planner', async (original) => ({
  ...(await original<typeof import('../server/services/menu-planner')>()),
  startProposal: planner.startProposal,
}));
const chat = vi.hoisted(() => ({ chatAboutDay: vi.fn() }));
vi.mock('../server/services/menu-chat', async (original) => ({
  ...(await original<typeof import('../server/services/menu-chat')>()),
  chatAboutDay: chat.chatAboutDay,
}));
const { default: router } = await import('../server/routes/planner');
const { csrfGuard, requireAuth } = await import('../server/middleware/auth');
const { createSession } = await import('../server/services/auth');
const { getDb, closeDb } = await import('../server/db');

let server: Server;
let base: string;
let cookie: string;

beforeAll(async () => {
  getDb().prepare("INSERT INTO users (id, email, password_hash) VALUES (1, 'planner-test@example.nl', 'unused')").run();
  cookie = `weekmenu_session=${createSession(1).token}`;
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api', csrfGuard, requireAuth);
  app.use('/api/planner', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/planner`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
});

beforeEach(() => {
  vi.resetAllMocks();
  llm.isModelConfigured.mockReturnValue(true);
});

const post = (path: string, body: unknown, headers = {}) => fetch(base + path, {
  method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const week = { week_number: 45, year: 2026, days: [{ day_name: 'Donderdag', recipe_id: null }] };

it('requires a session and blocks a cross-origin proposal', async () => {
  expect((await fetch(base)).status).toBe(401);
  expect((await post('/propose', week, { Origin: 'https://other.example' })).status).toBe(403);
  expect(planner.startProposal).not.toHaveBeenCalled();
});

it('gives the requested week, and refuses one that does not exist', async () => {
  const response = await fetch(`${base}?week=45&year=2026`, { headers: { Cookie: cookie } });
  expect(await response.json()).toMatchObject({ week_number: 45, year: 2026, configured: true, recipes: [], existing: null });
  expect((await fetch(`${base}?week=54&year=2026`, { headers: { Cookie: cookie } })).status).toBe(400);
});

it('checks the request before asking a model', async () => {
  const full = await post('/propose', { ...week, days: [{ day_name: 'Donderdag', recipe_id: 3 }] });
  expect(full.status).toBe(400);
  expect(await full.json()).toEqual({ error: 'Alle dagen zijn al gekozen' });
  expect((await post('/propose', { ...week, week_number: 0 })).status).toBe(400);

  llm.isModelConfigured.mockReturnValue(false);
  expect((await post('/propose', week)).status).toBe(503);
  expect(planner.startProposal).not.toHaveBeenCalled();
});

it('starts a proposal in the background, one at a time', async () => {
  planner.startProposal.mockReturnValueOnce(Promise.resolve()).mockReturnValueOnce(false);
  const started = await post('/propose', { ...week, wishes: ' iets met pompoen ' });
  expect(started.status).toBe(202);
  expect(planner.startProposal.mock.calls[0][1]).toEqual({ ...week, breakfasts: [], snacks: [], wishes: 'iets met pompoen' });
  expect((await post('/propose', week)).status).toBe(409);
});

const question = {
  week_number: 45, year: 2026, day_name: 'Zaterdag',
  days: [{ day_name: 'Zaterdag', recipe_id: null }],
  messages: [{ role: 'user', content: 'Iets met pompoen?' }],
};

it('answers a question to the assistant, and checks it first', async () => {
  chat.chatAboutDay.mockResolvedValue({ reply: 'Deze!', suggestions: [{ recipe_id: 3, reason: 'Pompoen.' }], model: 'cloud-gemma' });
  const answered = await post('/chat', question);
  expect(answered.status).toBe(200);
  expect(await answered.json()).toEqual({ reply: 'Deze!', suggestions: [{ recipe_id: 3, reason: 'Pompoen.' }], model: 'cloud-gemma' });
  expect(chat.chatAboutDay.mock.calls[0][1]).toEqual(question);

  expect((await post('/chat', { ...question, messages: [{ role: 'user', content: ' ' }] })).status).toBe(400);
  expect((await post('/chat', question, { Origin: 'https://other.example' })).status).toBe(403);
  llm.isModelConfigured.mockReturnValue(false);
  expect((await post('/chat', question)).status).toBe(503);
  expect(chat.chatAboutDay).toHaveBeenCalledTimes(1);
});

it('passes on what went wrong with the assistant', async () => {
  const { RecipeError } = await import('../server/services/recipes');
  chat.chatAboutDay.mockRejectedValue(new RecipeError('De assistent gaf geen antwoord (het duurde te lang); probeer het nog eens', 502));
  const failed = await post('/chat', question);
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: 'De assistent gaf geen antwoord (het duurde te lang); probeer het nog eens' });
});
