import { z } from 'zod';
import { getDb } from '../db.js';
import type { AhProduct } from '../../shared/albert-heijn.js';

// Unofficial mobile API; protocol references and login instructions are in docs/albert-heijn.md.
const BASE = 'https://api.ah.nl';
const CLIENT = 'appie-ios';
const ACTIVE_ORDER = '/mobile-services/order/v1/summaries/active?sortBy=DEFAULT';
const ORDER_ITEMS = '/mobile-services/order/v1/items?sortBy=DEFAULT';
export const AH_LOGIN_URL = `https://login.ah.nl/login?client_id=${CLIENT}&response_type=code&redirect_uri=appie%3A%2F%2Flogin-exit`;
export class AhStateError extends Error {}
export class AhAuthError extends AhStateError {}
export class AhCartUnavailableError extends AhStateError {}
export class AhApiError extends Error {
  constructor(public status: number) { super(`Albert Heijn is niet bereikbaar (HTTP ${status}). Probeer het later opnieuw.`); }
}

interface Account { member_id: string; access_token: string; refresh_token: string; expires_at: number }
const account = () => getDb().prepare('SELECT member_id, access_token, refresh_token, expires_at FROM ah_account WHERE id = 1').get() as Account | undefined;
export const ahStatus = () => ({ connected: !!account()?.access_token, login_url: AH_LOGIN_URL });
export const ahMemberId = () => account()?.member_id;
let generation = 0;
let refreshing: Promise<string> | null = null;

const tokens = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1), expires_in: z.number().positive(), member_id: z.union([z.string(), z.number()]).optional() });

async function send(method: string, path: string, body?: unknown, token?: string, orderId?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'User-Agent': 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)',
        'x-client-name': CLIENT, 'x-client-version': '9.28', 'x-application': 'AHWEBSHOP',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(orderId ? { 'appie-current-order-id': orderId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000), redirect: 'error',
    });
  } catch {
    // Do not expose response bodies, authorization codes, tokens or request headers.
    throw new Error('Albert Heijn gaf geen antwoord. Controleer de verbinding en probeer opnieuw.');
  }
  if (!response.ok) throw new AhApiError(response.status);
  if (response.status === 204) return null;
  try { return await response.json(); } catch { throw new Error('Albert Heijn gaf een onleesbaar antwoord.'); }
}

function saveTokens(value: unknown, memberId: string) {
  const result = tokens.safeParse(value);
  if (!result.success) throw new Error('Albert Heijn gaf geen geldige koppeling terug.');
  const t = result.data;
  getDb().prepare(`INSERT INTO ah_account (id, member_id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token,
      member_id = excluded.member_id, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`)
    .run(memberId, t.access_token, t.refresh_token, Date.now() + t.expires_in * 1000);
  return t.access_token;
}

/** Only the fixed app redirect or a raw one-time code is accepted; never fetch a pasted URL. */
export function authorizationCode(input: string): string {
  let code = input.trim();
  if (code.includes('://')) {
    let url: URL;
    try { url = new URL(code); } catch { throw new AhStateError('Plak de AH-inlogcode of de appie://login-exit-link.'); }
    if (url.protocol !== 'appie:' || url.hostname !== 'login-exit') throw new AhStateError('Dit is geen AH-inloglink.');
    code = url.searchParams.get('code') ?? '';
  }
  if (!/^[A-Za-z0-9._~+\/-]{4,2048}$/.test(code)) throw new AhStateError('Plak de volledige AH-inlogcode.');
  return code;
}

export async function connectAh(input: string) {
  const code = authorizationCode(input);
  const version = ++generation;
  try {
    const raw = await send('POST', '/mobile-auth/v1/auth/token', { clientId: CLIENT, code });
    const parsed = tokens.safeParse(raw);
    if (!parsed.success) throw new Error('Albert Heijn gaf geen geldige koppeling terug.');
    const result = parsed.data;
    // Bind unfinished writes to an AH member, never resume them in a different account.
    let memberId = result.member_id == null ? '' : String(result.member_id);
    if (!memberId) {
      const member = z.object({ data: z.object({ member: z.object({ id: z.union([z.string(), z.number()]) }) }) })
        .safeParse(await send('POST', '/graphql', { query: 'query WeekmenuMember { member { id } }' }, result.access_token));
      if (!member.success) throw new Error('Het AH-account kon niet worden herkend. Probeer opnieuw.');
      memberId = String(member.data.data.member.id);
    }
    const pending = getDb().prepare("SELECT member_id FROM ah_adds WHERE state = 'open'").get() as { member_id: string } | undefined;
    if (pending && pending.member_id !== memberId) throw new AhStateError('Rond de eerdere poging af met hetzelfde AH-account.');
    if (version !== generation) throw new AhStateError('De koppeling is ondertussen gewijzigd. Probeer opnieuw.');
    saveTokens(result, memberId);
  } catch (err) {
    if (err instanceof AhApiError && [400, 401, 403].includes(err.status))
      throw new AhAuthError('Deze inlogcode is verlopen of al gebruikt. Log opnieuw in bij Albert Heijn.');
    throw err;
  }
}

export function disconnectAh() {
  if (getDb().prepare("SELECT 1 FROM ah_adds WHERE state = 'open'").get())
    throw new AhStateError('Rond de eerdere AH-poging eerst af of breek haar af.');
  generation++;
  getDb().prepare('DELETE FROM ah_account WHERE id = 1').run();
}

async function accessToken(force = false): Promise<string> {
  const a = account();
  if (!a?.refresh_token) throw new AhAuthError('Koppel eerst Albert Heijn.');
  if (!force && a.expires_at > Date.now() + 60000) return a.access_token;
  if (refreshing) return refreshing;
  const version = generation;
  refreshing = (async () => {
    try {
      const result = await send('POST', '/mobile-auth/v1/auth/token/refresh', { clientId: CLIENT, refreshToken: a.refresh_token });
      if (generation !== version) throw new AhAuthError('De AH-koppeling is gewijzigd.');
      return saveTokens(result, a.member_id);
    } catch (err) {
      if (err instanceof AhApiError && [400, 401, 403].includes(err.status)) {
        if (generation === version) getDb().prepare("UPDATE ah_account SET access_token = '', refresh_token = '', expires_at = 0 WHERE id = 1").run();
        throw new AhAuthError('De AH-koppeling is verlopen. Koppel je account opnieuw.');
      }
      throw err;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

async function request(method: string, path: string, body?: unknown, orderId?: string) {
  const token = await accessToken();
  try { return await send(method, path, body, token, orderId); }
  catch (err) {
    // Reads may retry once. Writes are reconciled against the cart by the caller, never blindly replayed.
    if (err instanceof AhApiError && err.status === 401) {
      if (method === 'GET') return send(method, path, body, await accessToken(true), orderId);
      getDb().prepare('UPDATE ah_account SET expires_at = 0 WHERE id = 1').run();
      throw new AhAuthError('De AH-toegang moet worden vernieuwd. Controleer de eerdere poging opnieuw.');
    }
    throw err;
  }
}

const productCard = z.object({
  webshopId: z.number().int().positive(), title: z.string().min(1), brand: z.string().nullish(),
  salesUnitSize: z.string().nullish(), currentPrice: z.number().nonnegative().nullish(),
  mainCategory: z.string().nullish(), subCategory: z.string().nullish(),
  propertyIcons: z.array(z.string()).optional(), isOrderable: z.boolean().optional(),
});

export function mapAhProduct(value: unknown): AhProduct | null {
  const parsed = productCard.safeParse(value);
  if (!parsed.success || parsed.data.isOrderable === false) return null;
  const p = parsed.data;
  const category = `${p.mainCategory ?? ''} ${p.subCategory ?? ''}`.trim().toLowerCase();
  const name = p.title.toLowerCase();
  const icons = (p.propertyIcons ?? []).map(i => i.toLowerCase());
  const frozen = /diepvries|diepgevroren|bevroren|vriesvers/.test(`${name} ${category}`)
    || icons.some(i => /frozen|diepvries/.test(i));
  return {
    id: String(p.webshopId), name: p.title, unit_quantity: p.salesUnitSize ?? null,
    price: p.currentPrice == null ? null : Math.round(p.currentPrice * 100),
    // Missing category is unknown, not proof of freshness.
    frozen: frozen ? true : category ? false : null,
    organic: /\b(bio|biologisch|biologische|organic)\b/.test(name) || icons.some(i => /^(np_)?(biologisch|organic|bio)$/.test(i)),
    house_brand: /^(ah|albert heijn)(\b|$)/i.test(p.brand ?? '') || /^ah\b/i.test(p.title),
  };
}

export async function searchAhProducts(query: string): Promise<AhProduct[]> {
  const path = '/mobile-services/product/search/v2?' + new URLSearchParams({ query, sortOn: 'RELEVANCE', size: '15', page: '0' });
  const result = z.object({ products: z.array(z.unknown()) }).safeParse(await request('GET', path));
  if (!result.success) throw new Error('De AH-zoekresultaten zijn veranderd. Probeer het later opnieuw.');
  const unique = new Map<string, AhProduct>();
  for (const raw of result.data.products) { const p = mapAhProduct(raw); if (p) unique.set(p.id, p); }
  return [...unique.values()];
}

export async function getAhProduct(id: string): Promise<AhProduct | null> {
  try {
    const data = z.object({ productCard: z.unknown() }).parse(await request('GET', `/mobile-services/product/detail/v4/fir/${encodeURIComponent(id)}`));
    return mapAhProduct(data.productCard);
  } catch (err) {
    if (err instanceof AhApiError && err.status === 404) return null;
    throw err;
  }
}

const orderId = z.number().int().positive();
const orderFlags = {
  closingTime: z.string().datetime({ offset: true }).nullish(),
  modifiable: z.boolean().optional(), transactionCompleted: z.boolean().optional(),
};
const summarySchema = z.object({
  id: orderId.optional(), orderId: orderId.optional(), state: z.string().min(1),
  ...orderFlags,
  orderedProducts: z.array(z.object({
    quantity: z.number().int().nonnegative(),
    product: z.object({ webshopId: z.number().int().positive() }),
  })),
});
const detailsSchema = z.object({ orderId, orderState: z.string().min(1), ...orderFlags });
type OrderFlags = z.infer<typeof detailsSchema>;
export interface AhCart {
  id: string;
  quantities: Map<string, number>;
  states: string[];
  closingTimes: string[];
  modifiable: boolean;
}
const noCart = () => new AhCartUnavailableError('Er is geen actieve bestelling bij Albert Heijn. Open eerst een winkelmandje in de AH-app en probeer opnieuw.');

/** Read quantities from the active order; details carry its closingTime. Never reopen/submit an order. */
export async function readAhCart(expectedId?: string): Promise<AhCart> {
  let raw: unknown;
  try { raw = await request('GET', ACTIVE_ORDER); }
  catch (err) { if (err instanceof AhApiError && err.status === 404) throw noCart(); throw err; }
  if (raw === null || (typeof raw === 'object' && raw !== null &&
    ('id' in raw && raw.id === 0 || 'orderId' in raw && raw.orderId === 0))) throw noCart();
  const result = summarySchema.safeParse(raw);
  if (!result.success || (!result.data.id && !result.data.orderId))
    throw new AhStateError('Het AH-winkelmandje kon niet betrouwbaar worden gelezen. Er is niets opnieuw verstuurd.');
  const summary = result.data;
  if (summary.id && summary.orderId && summary.id !== summary.orderId)
    throw new AhStateError('Albert Heijn gaf verschillende bestelnummers terug. Probeer het later opnieuw.');
  const id = String(summary.id ?? summary.orderId);
  if (expectedId && id !== expectedId)
    throw new AhCartUnavailableError('Er is nu een andere bestelling actief bij Albert Heijn. Breek de eerdere poging af en controleer de AH-app.');
  const details = detailsSchema.safeParse(await request('GET', `/mobile-services/order/v1/${id}/details-grouped-by-taxonomy`, undefined, id));
  if (!details.success || String(details.data.orderId) !== id)
    throw new AhStateError('De status van de AH-bestelling kon niet betrouwbaar worden gelezen. Er is niets verstuurd.');
  const flags: Array<Pick<OrderFlags, 'closingTime' | 'modifiable' | 'transactionCompleted'>> = [summary, details.data];
  const quantities = new Map<string, number>();
  for (const row of summary.orderedProducts) {
    const productId = String(row.product.webshopId);
    if (quantities.has(productId)) throw new AhStateError('Het AH-winkelmandje bevat dubbele productregels. Controleer het mandje in de AH-app.');
    quantities.set(productId, row.quantity);
  }
  return { id, quantities, states: [summary.state, details.data.orderState],
    closingTimes: flags.flatMap(f => f.closingTime ? [f.closingTime] : []),
    modifiable: flags.every(f => f.modifiable !== false && f.transactionCompleted !== true) };
}

export function requireWritableAhCart(cart: AhCart) {
  if (!cart.modifiable || cart.states.some(state => state !== 'OPEN') ||
    cart.closingTimes.some(time => Date.parse(time) <= Date.now()))
    throw new AhStateError('Deze AH-bestelling is al gesloten of afgerond, of de sluitingstijd is voorbij. Open een wijzigbaar winkelmandje in de AH-app. Er is niets toegevoegd.');
}

/** PUT sets absolute quantities, never increments. Pin the write to the order that supplied the baseline. */
export async function setAhQuantities(cart: AhCart, products: Array<{ id: string; quantity: number }>) {
  requireWritableAhCart(cart);
  if (new Set(products.map(p => p.id)).size !== products.length)
    throw new AhStateError('Een product mag maar één keer in een AH-aanvraag voorkomen.');
  await request('PUT', ORDER_ITEMS, { items: products.map(p => ({
    productId: Number(p.id), quantity: p.quantity, originCode: 'PRD', description: '', strikethrough: false,
  })) }, cart.id);
}
