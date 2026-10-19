// @vitest-environment node
import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { AhLine, AhProduct } from '../shared/albert-heijn';
process.env.DATABASE_PATH = ':memory:';
const { getDb, closeDb } = await import('../server/db');
const client = await import('../server/services/ah-client');
const ah = await import('../server/services/albert-heijn');
const preferences = await import('../server/services/picnic-preferences');
const picnic = await import('../server/services/picnic');

const card = (id: number, title = 'AH halfvolle melk', extra: Record<string, unknown> = {}) => ({
  webshopId: id, title, brand: 'AH', salesUnitSize: '1 liter', currentPrice: 1.29,
  mainCategory: 'Zuivel, plantaardig en eieren', propertyIcons: [], isOrderable: true, ...extra,
});
const product: AhProduct = { id: '123', name: 'AH halfvolle melk', unit_quantity: '1 liter', price: 129, frozen: false, organic: false, house_brand: true };
let list: Map<string, number>;
let searches: Record<string, unknown[]>;
let details: Record<string, unknown>;
let writes: Array<Array<{ productId: number; quantity: number }>>;
let failRead: boolean;
let patchMode: 'ok' | 'lost' | 'partial' | 'unreadable' | 'refused';
let tokenStatus: number;
let memberId: string;
let calls: Array<{ path: string; method: string; body: any; headers: any }>;
let onRefresh: (() => Promise<void>) | null;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function menu(week = 43) { return Number(getDb().prepare('INSERT INTO menus (week_number, year) VALUES (?, 2026)').run(week).lastInsertRowid); }
function item(menuId: number, name = 'halfvolle melk', quantity = '2 l', group = 'zuivel') {
  return Number(getDb().prepare('INSERT INTO shopping_items (menu_id, item_name, quantity, product_group) VALUES (?, ?, ?, ?)').run(menuId, name, quantity, group).lastInsertRowid);
}
const line = (id: number, fields: Partial<AhLine> = {}): AhLine => ({ item_id: id, product, count: 2, picked: false, ...fields });
const checked = (id: number) => (getDb().prepare('SELECT checked FROM shopping_items WHERE id = ?').get(id) as { checked: number }).checked;

beforeEach(async () => {
  getDb().exec('DELETE FROM ah_adds; DELETE FROM ah_products; DELETE FROM ah_account; DELETE FROM picnic_adds; DELETE FROM shopping_items; DELETE FROM pantry_check; DELETE FROM menus;');
  list = new Map(); searches = {}; details = {}; writes = []; calls = [];
  failRead = false; patchMode = 'ok'; tokenStatus = 200; memberId = 'member-1'; onRefresh = null;
  vi.stubGlobal('fetch', vi.fn(async (input: string, options: RequestInit = {}) => {
    const url = new URL(input); const path = url.pathname;
    const body = options.body ? JSON.parse(String(options.body)) : undefined;
    const method = options.method ?? 'GET';
    calls.push({ path, method, body, headers: options.headers });
    if (path.startsWith('/mobile-auth/')) {
      if (path.endsWith('/refresh')) await onRefresh?.();
      return response({ access_token: 'fake-access', refresh_token: 'fake-refresh', expires_in: 7200, member_id: memberId }, tokenStatus);
    }
    if (path.includes('/product/search/')) return response({ products: searches[url.searchParams.get('query')!] ?? [] });
    if (path.includes('/product/detail/')) return details[path.split('/').pop()!] ? response({ productCard: details[path.split('/').pop()!] }) : response({}, 404);
    if (path === '/mobile-services/shoppinglist/v2/items') {
      if (method === 'PATCH') {
        writes.push(body.items);
        if (patchMode !== 'refused') for (const p of body.items.slice(0, patchMode === 'partial' ? 1 : undefined)) list.set(String(p.productId), p.quantity);
        if (patchMode === 'unreadable') failRead = true;
        if (['lost', 'partial', 'unreadable', 'refused'].includes(patchMode)) throw new Error('network error with a secret');
      }
      if (failRead) throw new Error('read failed with a secret');
      return response({ items: [...list].map(([id, quantity]) => ({ quantity, productDetails: { product: { webshopId: Number(id) } } })) });
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  }));
  await ah.connectAhAccount('test-code'); calls = [];
});
afterAll(() => { vi.unstubAllGlobals(); closeDb(); });

describe('AH connection and transport', () => {
  it('keeps tokens server-side and accepts only AH redirect links', async () => {
    expect(client.ahStatus()).toEqual({ connected: true, login_url: expect.stringContaining('login.ah.nl/login?') });
    expect(client.authorizationCode('appie://login-exit?code=one-time-code')).toBe('one-time-code');
    expect(() => client.authorizationCode('https://other.example/?code=abcd')).toThrow('geen AH-inloglink');
    await ah.connectAhAccount('appie://login-exit?code=one-time-code');
    expect(calls[0].body).toEqual({ clientId: 'appie-ios', code: 'one-time-code' });
    expect(JSON.stringify(client.ahStatus())).not.toContain('fake-access');
  });
  it('refreshes once when several product searches start together', async () => {
    getDb().prepare('UPDATE ah_account SET expires_at = 0').run();
    onRefresh = () => new Promise(resolve => setTimeout(resolve, 10));
    await Promise.all([client.searchAhProducts('melk'), client.searchAhProducts('kaas'), client.searchAhProducts('ei')]);
    expect(calls.filter(c => c.path.endsWith('/refresh'))).toHaveLength(1);
    expect(calls.find(c => c.path.endsWith('/refresh'))!.body).toEqual({ clientId: 'appie-ios', refreshToken: 'fake-refresh' });
  });
  it('invalidates expired credentials without disclosing the upstream response', async () => {
    getDb().prepare('UPDATE ah_account SET expires_at = 0').run(); tokenStatus = 401;
    await expect(client.searchAhProducts('melk')).rejects.toThrow('opnieuw');
    expect(client.ahStatus().connected).toBe(false);
  });
  it('does not restore a disconnected account after an in-flight token refresh', async () => {
    getDb().prepare('UPDATE ah_account SET expires_at = 0').run();
    let finish!: () => void;
    onRefresh = () => new Promise(resolve => { finish = resolve; });
    const pending = client.searchAhProducts('melk');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await ah.disconnectAhAccount(); finish();
    await expect(pending).rejects.toThrow('gewijzigd');
    expect(client.ahStatus().connected).toBe(false);
  });
  it('maps euros, categories, AH brands and organic icons', () => {
    expect(client.mapAhProduct(card(123, 'AH bessen', { currentPrice: 2.49, mainCategory: 'Diepvries', propertyIcons: ['np_biologisch'] })))
      .toMatchObject({ id: '123', price: 249, frozen: true, organic: true, house_brand: true });
    expect(client.mapAhProduct(card(123, 'Bessen', { mainCategory: null }))?.frozen).toBeNull();
    expect(client.mapAhProduct(card(123, 'Melk', { isOrderable: false }))).toBeNull();
    expect(client.mapAhProduct({ title: 'No ID' })).toBeNull();
  });
});

describe('AH suggestions', () => {
  it('counts packs and prefers the AH house brand, while excluding pantry items', async () => {
    const m = menu(); item(m); item(m, 'sojasaus', '50 ml', 'sauzen');
    searches = { 'halfvolle melk': [card(1, 'Campina halfvolle melk', { brand: 'Campina' }), card(123)], sojasaus: [card(2, 'AH sojasaus')] };
    const rows = await ah.suggestForAhMenu(m);
    expect(rows.find(r => r.item_name === 'halfvolle melk')).toMatchObject({ product: { id: '123' }, count: 2, selected: true });
    expect(rows.find(r => r.item_name === 'sojasaus')).toMatchObject({ selected: false, note: 'voorraadkast' });
  });
  it('keeps in-house products and unknown temperature off', async () => {
    const m = menu(); item(m); item(m, 'bessen', '200 g', 'fruit');
    getDb().prepare('INSERT INTO pantry_check (menu_id, item_name, have_it) VALUES (?, ?, 1)').run(m, 'halfvolle melk');
    searches = { 'halfvolle melk': [card(123)], bessen: [card(2, 'AH bessen', { mainCategory: null })] };
    const rows = await ah.suggestForAhMenu(m);
    expect(rows.every(r => !r.selected)).toBe(true);
    expect(rows.find(r => r.item_name === 'bessen')!.note).toMatch(/onbekend/);
  });
  it('selects a fourth frozen result and rejects a remembered frozen product for fresh', async () => {
    const m = menu(); item(m, 'diepvries blauwe bessen', '250 g', 'fruit');
    const hits = [1, 2, 3, 4].map(id => card(id, 'AH blauwe bessen', { mainCategory: id === 4 ? 'Diepvries' : 'Fruit', salesUnitSize: '250 gram' }));
    searches['diepvries blauwe bessen'] = hits;
    expect((await ah.suggestForAhMenu(m))[0]).toMatchObject({ product: { id: '4', frozen: true }, selected: true });
    const fresh = menu(44); item(fresh, 'blauwe bessen', '250 g', 'fruit'); searches['blauwe bessen'] = hits;
    getDb().prepare('INSERT INTO ah_products (item_key, product_id, picked) VALUES (?, ?, 1)').run('blauwe bessen', '4'); details['4'] = hits[3];
    expect((await ah.suggestForAhMenu(fresh))[0].product!.id).not.toBe('4');
  });
  it('keeps a valid manual choice and reads its current price', async () => {
    const m = menu(); item(m); searches['halfvolle melk'] = [card(123)];
    details['99'] = card(99, 'Campina halfvolle melk', { brand: 'Campina', currentPrice: 1.88 });
    getDb().prepare('INSERT INTO ah_products (item_key, product_id, picked) VALUES (?, ?, 1)').run('halfvolle melk', '99');
    expect((await ah.suggestForAhMenu(m))[0]).toMatchObject({ product: { id: '99', price: 188 }, remembered: true, picked: true });
  });
  it('replaces stale search metadata with details before ranking a remembered product', async () => {
    const m = menu(); item(m, 'blauwe bessen', '250 g', 'fruit');
    searches['blauwe bessen'] = [card(123, 'AH blauwe bessen', { mainCategory: 'Fruit' })];
    details['123'] = card(123, 'AH blauwe bessen', { mainCategory: 'Diepvries' });
    getDb().prepare('INSERT INTO ah_products (item_key, product_id, picked) VALUES (?, ?, 1)').run('blauwe bessen', '123');
    expect((await ah.suggestForAhMenu(m))[0]).toMatchObject({ product: { frozen: true }, selected: false });
    delete details['123'];
    expect((await ah.suggestForAhMenu(m))[0]).toMatchObject({ product: null, selected: false });
  });
  it('reuses the corrected alternatives, multiword qualifiers and plain dairy rules', () => {
    expect(preferences.hasQualifier('Alpro amandeldrink zonder suiker', 'ongezoete')).toBe(true);
    expect(preferences.isRelevant(preferences.itemWish('yoghurt of kwark', 'zuivel', null), 'AH kwark')).toBe(true);
    expect(preferences.isRelevant(preferences.itemWish('yoghurt', 'zuivel', null), 'AH bio yoghurt aardbei')).toBe(false);
  });
});

describe('AH list writes and reconciliation', () => {
  it('preserves existing quantities, aggregates products and never repeats a successful request', async () => {
    const m = menu(); const a = item(m); const b = item(m, 'melk'); list.set('123', 3);
    const lines = [line(a, { picked: true }), line(b, { count: 1 })];
    expect(await ah.addToAhList(m, 'request-0001', lines)).toEqual({ added: 2 });
    expect(writes[0]).toEqual([expect.objectContaining({ productId: 123, quantity: 6 })]);
    expect(checked(a)).toBe(1); expect(checked(b)).toBe(1);
    expect(await ah.addToAhList(m, 'request-0001', lines)).toEqual({ added: 2 });
    expect(writes).toHaveLength(1);
    expect(getDb().prepare('SELECT product_id, picked FROM ah_products WHERE item_key = ?').get('halfvolle melk')).toEqual({ product_id: '123', picked: 1 });
  });
  it('confirms a lost PATCH response by reading the list', async () => {
    const m = menu(); const id = item(m); patchMode = 'lost';
    expect(await ah.addToAhList(m, 'request-0001', [line(id)])).toEqual({ added: 1 });
    expect(checked(id)).toBe(1); expect(writes).toHaveLength(1);
  });
  it('holds an uncertain request and resumes without doubling after a later retry', async () => {
    const m = menu(); const id = item(m); patchMode = 'unreadable';
    await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow();
    expect(checked(id)).toBe(0); expect(ah.unfinishedAh()).toHaveLength(1);
    failRead = false; patchMode = 'ok';
    expect(await ah.settleAhAttempt(m, 'request-0001')).toEqual({ added: 1 });
    expect(writes).toHaveLength(1); expect(checked(id)).toBe(1);
  });
  it('only retries missing absolute targets after partial success', async () => {
    const m = menu(); const a = item(m); const b = item(m, 'kwark'); patchMode = 'partial';
    const lines = [line(a), line(b, { product: { ...product, id: '124' } })];
    await expect(ah.addToAhList(m, 'request-0001', lines)).rejects.toThrow('Nog niet alles');
    expect(checked(a)).toBe(1); expect(checked(b)).toBe(0);
    patchMode = 'ok'; await ah.settleAhAttempt(m, 'request-0001');
    expect(writes[1]).toEqual([expect.objectContaining({ productId: 124, quantity: 2 })]);
    expect(list.get('123')).toBe(2);
  });
  it('abandon keeps confirmed lines checked without another write', async () => {
    const m = menu(); const a = item(m); const b = item(m, 'kwark'); patchMode = 'partial';
    await expect(ah.addToAhList(m, 'request-0001', [line(a), line(b, { product: { ...product, id: '124' } })])).rejects.toThrow();
    expect(await ah.settleAhAttempt(m, 'request-0001', true)).toEqual({ added: 1 });
    expect(checked(a)).toBe(1); expect(checked(b)).toBe(0); expect(writes).toHaveLength(1); expect(ah.unfinishedAh()).toHaveLength(0);
  });
  it('blocks changed requests, duplicate items and other weeks while an attempt is open', async () => {
    const m = menu(); const id = item(m);
    await expect(ah.addToAhList(m, 'request-0001', [line(id), line(id)])).rejects.toThrow('maximaal');
    patchMode = 'refused'; await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow();
    await expect(ah.addToAhList(m, 'request-0001', [line(id, { count: 3 })])).rejects.toThrow('andere keuze');
    const next = menu(44); const id2 = item(next);
    await expect(ah.addToAhList(next, 'request-0002', [line(id2)])).rejects.toThrow('eerdere AH');
    await expect(ah.disconnectAhAccount()).rejects.toThrow('eerdere AH');
  });
  it('reports packages already present for an incomplete line when abandoning', async () => {
    const m = menu(); const id = item(m); patchMode = 'refused';
    await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow();
    list.set('123', 1);
    expect(await ah.settleAhAttempt(m, 'request-0001', true)).toEqual({ added: 0, partly: ['AH halfvolle melk: 1 verpakking(en)'] });
    expect(checked(id)).toBe(0); expect(writes).toHaveLength(1);
  });
  it('does not send a pending attempt to a different AH member', async () => {
    const m = menu(); const id = item(m); patchMode = 'refused';
    await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow(); memberId = 'different-member';
    await expect(ah.connectAhAccount('new-code')).rejects.toThrow('hetzelfde AH-account');
    expect(client.ahMemberId()).toBe('member-1');
  });
  it('rejects checked and foreign items and allows retry after an initial read failure', async () => {
    const m = menu(); const id = item(m); const next = menu(44);
    await expect(ah.addToAhList(next, 'request-0001', [line(id)])).rejects.toThrow('hoort niet');
    failRead = true; await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow();
    expect(ah.unfinishedAh()).toHaveLength(0); expect(writes).toHaveLength(0);
    failRead = false; await ah.addToAhList(m, 'request-0001', [line(id)]);
    await expect(ah.addToAhList(m, 'request-0002', [line(id)])).rejects.toThrow('afgevinkt');
  });
  it('refuses to restore quantities that were manually removed after the first attempt', async () => {
    const m = menu(); const id = item(m); list.set('123', 3); patchMode = 'refused';
    await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow();
    list.set('123', 1); patchMode = 'ok';
    await expect(ah.settleAhAttempt(m, 'request-0001')).rejects.toThrow('ondertussen aangepast');
    expect(writes).toHaveLength(1);
  });
  it('keeps the same items out of concurrent Picnic attempts', async () => {
    const m = menu(); const id = item(m); patchMode = 'refused';
    await expect(ah.addToAhList(m, 'request-0001', [line(id)])).rejects.toThrow();
    await expect(picnic.addToCart(m, 'request-picnic', [{ item_id: id, product: { ...product, frozen: false }, count: 2 }])).rejects.toThrow('Albert Heijn');
  });
});
