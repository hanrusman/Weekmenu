// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
process.env.DATABASE_PATH = ':memory:';
const service = vi.hoisted(() => ({ connectAhAccount: vi.fn(), disconnectAhAccount: vi.fn(), searchForAhItem: vi.fn(), suggestForAhMenu: vi.fn(), unfinishedAh: vi.fn(), addToAhCart: vi.fn(), settleAhAttempt: vi.fn() }));
vi.mock('../server/services/albert-heijn', () => service);
const { default: router } = await import('../server/routes/albert-heijn');
const { csrfGuard, requireAuth } = await import('../server/middleware/auth');
const { createSession } = await import('../server/services/auth');
const { getDb, closeDb } = await import('../server/db');
let server: Server; let base: string; let cookie: string;
beforeAll(async () => {
  getDb().prepare("INSERT INTO users (id, email, password_hash) VALUES (1, 'ah-test@example.nl', 'unused')").run();
  cookie = `weekmenu_session=${createSession(1).token}`;
  const app = express(); app.use(express.json(), cookieParser());
  app.use('/api', csrfGuard, requireAuth);
  app.use('/api/albert-heijn', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/albert-heijn`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); closeDb(); });
beforeEach(() => { vi.resetAllMocks(); service.unfinishedAh.mockReturnValue([]); });
const post = (path: string, body: unknown, headers = {}) => fetch(base + path, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
it('requires a session and blocks cross-origin mutation before contacting AH', async () => {
  expect((await fetch(base + '/status')).status).toBe(401);
  expect((await post('/connect', { code: 'test-code' }, { Origin: 'https://other.example' })).status).toBe(403);
  expect(service.connectAhAccount).not.toHaveBeenCalled();
});
it('returns only public status and prevents caching', async () => {
  getDb().prepare("INSERT INTO ah_account VALUES (1, 'member', 'private-access', 'private-refresh', 9999999999999)").run();
  const response = await fetch(base + '/status', { headers: { Cookie: cookie } });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ connected: true, login_url: expect.stringContaining('https://login.ah.nl/') });
});
it('rejects bad IDs and out-of-bounds counts before writing', async () => {
  const product = { id: '123', name: 'Melk', unit_quantity: null, price: null, frozen: false, organic: false, house_brand: true };
  const body = { request_id: 'request-123', lines: [{ item_id: 1, product, count: 51, picked: false }] };
  expect((await post('/menus/1/cart', body)).status).toBe(400);
  expect((await post('/menus/nope/cart', { ...body, lines: [{ ...body.lines[0], count: 1 }] })).status).toBe(400);
  expect(service.addToAhCart).not.toHaveBeenCalled();
});
it('hides upstream secrets and relays successful cart results', async () => {
  service.connectAhAccount.mockRejectedValue(new Error('Bearer secret upstream body'));
  const failed = await post('/connect', { code: 'test-code' });
  expect(failed.status).toBe(502);
  expect(await failed.text()).not.toMatch(/secret|Bearer/);
  service.settleAhAttempt.mockResolvedValue({ added: 2 });
  const response = await post('/menus/3/cart/request-123/finish', {});
  expect(await response.json()).toEqual({ added: 2 });
  expect(service.settleAhAttempt).toHaveBeenCalledWith(3, 'request-123', false);
});

it('relays the safe AH 503 message instead of a generic failure', async () => {
  const { AhApiError } = await import('../server/services/ah-client');
  service.connectAhAccount.mockRejectedValue(new AhApiError(503));
  const failed = await post('/connect', { code: 'test-code' });
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: 'Albert Heijn is niet bereikbaar (HTTP 503). Probeer het later opnieuw.' });
});
