import crypto from 'crypto';
import PicnicClient from 'picnic-api';
import { getDb } from '../db.js';
import { normalizeUnit, parseAmount } from './ingredients.js';
import { defaultFactor } from './piece-weights.js';

/**
 * Picnic (online supermarket) through the unofficial picnic-api library: log
 * in once with the SMS code, then put this week's shopping list in the
 * basket. Only the auth key is kept; ordering and paying stay in the app.
 */

export interface PicnicProduct {
  id: string;
  name: string;
  unit_quantity: string | null;
  /** Cents. */
  price: number | null;
}

/** The part of picnic-api this app uses, so tests can stand in for Picnic. */
export interface PicnicApi {
  authKey: string | null;
  auth: {
    login(username: string, password: string): Promise<{ second_factor_authentication_required: boolean }>;
    generate2FACode(channel: string): Promise<unknown>;
    verify2FACode(code: string): Promise<{ authKey: string }>;
  };
  catalog: {
    search(query: string): Promise<Array<{ id: string; name: string; unit_quantity?: string; display_price?: number }>>;
    getProductDetails(productId: string): Promise<{ id: string; name: string; brand: string | null; unitQuantity: string; displayPrice: number }>;
  };
  cart: {
    getCart(): Promise<PicnicCart>;
    addProductsToCart(products: Array<{ productId: string; quantity: number }>): Promise<PicnicCart>;
  };
}

/** The part of Picnic's cart this app reads: totals, and how many of each product. */
export interface PicnicCart {
  total_count: number;
  total_price: number;
  items?: Array<{ items?: Array<{ id: string; decorators?: Array<{ type?: string; quantity?: number }> }> }>;
}

type ClientFactory = (options: { authKey?: string; deviceId: string }) => PicnicApi;

const defaultFactory: ClientFactory = ({ authKey, deviceId }) => new PicnicClient({
  countryCode: 'NL',
  authKey,
  // Its own device id instead of the library's shared default
  deviceId,
  // Picnic turns some endpoints off for app versions it considers too old
  ...(process.env.PICNIC_AGENT ? { agent: process.env.PICNIC_AGENT } : {}),
}) as unknown as PicnicApi;

let factory: ClientFactory = defaultFactory;

/** Tests: talk to a fake Picnic instead. */
export function setPicnicClientFactory(f: ClientFactory | null) {
  factory = f ?? defaultFactory;
}

/** The account's auth key is no longer accepted: log in again. */
export class PicnicAuthError extends Error {}
/** Something the person has to fix (no account, wrong code, already in the basket). */
export class PicnicStateError extends Error {}
/** Picnic may or may not have filled the basket; a retry looks in the basket first. */
export class PicnicUncertainError extends PicnicStateError {}

interface AccountRow {
  email: string | null;
  auth_key: string | null;
  pending: number;
  device_id: string;
}

function account(): AccountRow {
  const db = getDb();
  const row = db.prepare('SELECT email, auth_key, pending, device_id FROM picnic_account WHERE id = 1').get() as AccountRow | undefined;
  if (row) return row;
  const deviceId = crypto.randomBytes(8).toString('hex').toUpperCase();
  db.prepare('INSERT INTO picnic_account (id, device_id) VALUES (1, ?)').run(deviceId);
  return { email: null, auth_key: null, pending: 0, device_id: deviceId };
}

function saveAccount(fields: { email?: string | null; auth_key: string | null; pending: boolean }) {
  account(); // make sure the row exists
  getDb().prepare(`
    UPDATE picnic_account SET email = COALESCE(?, email), auth_key = ?, pending = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(fields.email ?? null, fields.auth_key, fields.pending ? 1 : 0);
}

export function picnicStatus(): { connected: boolean; awaitingCode: boolean; email: string | null } {
  const row = account();
  return {
    connected: !!row.auth_key && !row.pending,
    awaitingCode: !!row.auth_key && !!row.pending,
    email: row.email,
  };
}

function isAuthFailure(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\b401\b|unauthori[sz]ed|AUTH_|auth key|not authenticated/i.test(message);
}

/** A client for the connected account; an auth failure on any call drops the key. */
async function withClient<T>(fn: (client: PicnicApi) => Promise<T>): Promise<T> {
  const row = account();
  if (!row.auth_key || row.pending) throw new PicnicStateError('Picnic is nog niet gekoppeld');
  const client = factory({ authKey: row.auth_key, deviceId: row.device_id });
  try {
    return await fn(client);
  } catch (err) {
    if (isAuthFailure(err)) {
      saveAccount({ auth_key: null, pending: false });
      throw new PicnicAuthError('Picnic heeft de koppeling verbroken, log opnieuw in');
    }
    throw err;
  }
}

/**
 * Log in with email and password. The password is passed on to Picnic and
 * not kept. Usually Picnic asks for a code next, which it sends by SMS.
 */
export async function startLogin(email: string, password: string): Promise<{ awaitingCode: boolean }> {
  const row = account();
  const client = factory({ deviceId: row.device_id });
  const result = await client.auth.login(email, password);
  if (!client.authKey) throw new Error('Picnic gaf geen sleutel terug');
  if (result.second_factor_authentication_required) {
    saveAccount({ email, auth_key: client.authKey, pending: true });
    await client.auth.generate2FACode('SMS');
    return { awaitingCode: true };
  }
  saveAccount({ email, auth_key: client.authKey, pending: false });
  return { awaitingCode: false };
}

function pendingClient(): PicnicApi {
  const row = account();
  if (!row.auth_key || !row.pending) throw new PicnicStateError('Er wacht geen inlogcode; log opnieuw in');
  return factory({ authKey: row.auth_key, deviceId: row.device_id });
}

export async function resendCode(): Promise<void> {
  await pendingClient().auth.generate2FACode('SMS');
}

export async function verifyCode(code: string): Promise<void> {
  const client = pendingClient();
  const { authKey } = await client.auth.verify2FACode(code);
  saveAccount({ auth_key: authKey, pending: false });
}

export function disconnect(): void {
  account();
  getDb().prepare(`
    UPDATE picnic_account SET email = NULL, auth_key = NULL, pending = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1
  `).run();
}

export async function searchProducts(query: string, limit = 8): Promise<PicnicProduct[]> {
  const results = await withClient((c) => c.catalog.search(query));
  const seen = new Set<string>();
  const products: PicnicProduct[] = [];
  for (const r of results) {
    if (!r?.id || seen.has(r.id)) continue; // the same product shows up in several tiles
    seen.add(r.id);
    products.push({
      id: r.id,
      name: r.name,
      unit_quantity: r.unit_quantity ?? null,
      price: typeof r.display_price === 'number' ? r.display_price : null,
    });
    if (products.length >= limit) break;
  }
  return products;
}

type Measure = 'g' | 'ml' | 'stuks';

function measureOf(unit: string): { measure: Measure; factor: number } | null {
  if (unit === 'cl') return { measure: 'ml', factor: 10 };
  const n = normalizeUnit(unit);
  if (n.unit === 'g' || n.unit === 'ml' || n.unit === 'stuks') return { measure: n.unit, factor: n.factor };
  return null;
}

/** What one Picnic pack holds: "500 gram", "1 kilo", "3 x 125 gram", "per stuk", "6 stuks". */
export function packSize(unitQuantity: string | null | undefined): { amount: number; measure: Measure } | null {
  if (!unitQuantity) return null;
  const s = unitQuantity.toLowerCase().replace(/,/g, '.').replace(/\b(ca\.?|circa|±)\s*/g, '').trim();
  if (/^per\s+stuk$|^stuk$/.test(s)) return { amount: 1, measure: 'stuks' };
  const multi = s.match(/(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (multi) {
    const m = measureOf(multi[3]);
    return m ? { amount: Number(multi[1]) * Number(multi[2]) * m.factor, measure: m.measure } : null;
  }
  const single = s.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (!single) return null;
  const m = measureOf(single[2]);
  return m ? { amount: Number(single[1]) * m.factor, measure: m.measure } : null;
}

/**
 * How many packs cover a shopping-list quantity ("650 g", "3 stuks, 200 g").
 * Parts in another measure count when the ingredient has a typical weight
 * (3 uien → grams); a little short (up to 10%) still rounds down. One when
 * nothing can be compared.
 */
export function packsNeeded(quantity: string | null, unitQuantity: string | null, itemName: string, max = 24): number {
  const pack = packSize(unitQuantity);
  if (!pack || !quantity) return 1;
  let need = 0;
  for (const part of quantity.split(',')) {
    const m = part.trim().match(/^(\S+)\s*(.*)$/);
    if (!m) continue;
    const amount = parseAmount(m[1]);
    if (amount === null) continue;
    const own = measureOf(m[2] || 'stuks');
    if (own) {
      if (own.measure === pack.measure) {
        need += amount * own.factor;
        continue;
      }
      const factor = defaultFactor(itemName, own.measure, pack.measure);
      if (factor !== undefined) need += amount * own.factor * factor;
      continue;
    }
    const n = normalizeUnit(m[2]);
    const factor = defaultFactor(itemName, n.unit, pack.measure);
    if (factor !== undefined) need += amount * n.factor * factor;
  }
  if (need <= 0) return 1;
  return Math.min(max, Math.max(1, Math.ceil(need / pack.amount - 0.1)));
}

/** Only spoons and pinches: a staple from the cupboard, not something to order each week. */
function isCupboardAmount(quantity: string | null): boolean {
  if (!quantity) return false;
  const parts = quantity.split(',').map((p) => normalizeUnit(p.trim().replace(/^\S+\s*/, '')).unit);
  return parts.length > 0 && parts.every((u) => ['el', 'tl', 'snuf', 'snufje', 'mespunt', 'scheut'].includes(u));
}

const itemKey = (name: string) => name.trim().toLowerCase();

/** Search hits and cart lines may or may not carry Picnic's "s" prefix. */
const sameProduct = (a: string, b: string) => a.replace(/^s/, '') === b.replace(/^s/, '');
const productKey = (id: string) => id.replace(/^s/, '');

/** A product with the number of packs it takes for one shopping item. */
export type CountedProduct = PicnicProduct & { count: number };

interface ShoppingRow { id: number; item_name: string; quantity: string | null; product_group: string }

function shoppingItem(itemId: number): ShoppingRow | undefined {
  return getDb().prepare('SELECT id, item_name, quantity, product_group FROM shopping_items WHERE id = ?')
    .get(itemId) as ShoppingRow | undefined;
}

const counted = (item: ShoppingRow, p: PicnicProduct): CountedProduct =>
  ({ ...p, count: packsNeeded(item.quantity, p.unit_quantity, item.item_name) });

/** Search hits for one shopping item, each with the packs it would take. */
export async function searchForItem(itemId: number, query: string): Promise<CountedProduct[]> {
  const item = shoppingItem(itemId);
  if (!item) throw new PicnicStateError('Boodschap niet gevonden');
  return (await searchProducts(query)).map((p) => counted(item, p));
}

/**
 * Current name, pack and price of a product by id; null when Picnic no longer
 * has it. An expired login still counts as an error.
 */
async function currentProduct(id: string): Promise<PicnicProduct | null> {
  try {
    const d = await withClient((c) => c.catalog.getProductDetails(id));
    const name = d.brand && !d.name.toLowerCase().startsWith(d.brand.toLowerCase()) ? `${d.brand} ${d.name}` : d.name;
    return { id, name, unit_quantity: d.unitQuantity || null, price: Number.isFinite(d.displayPrice) ? d.displayPrice : null };
  } catch (err) {
    if (err instanceof PicnicAuthError) throw err;
    return null;
  }
}

export interface Suggestion {
  item_id: number;
  item_name: string;
  quantity: string | null;
  product_group: string;
  product: PicnicProduct | null;
  /** The product chosen for this item before, with today's name, pack and price. */
  remembered: boolean;
  /** The product chosen before when Picnic no longer has it; product is then a replacement. */
  previous: string | null;
  count: number;
  /** Proposed to go in the basket; off for cupboard staples and what is in the house. */
  selected: boolean;
  /** Search hits to pick from instead, each with its own pack count. */
  alternatives: CountedProduct[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

const REMEMBER_SQL = `
  INSERT INTO picnic_products (item_key, product_id, name, unit_quantity, price, updated_at)
  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(item_key) DO UPDATE SET product_id = excluded.product_id, name = excluded.name,
    unit_quantity = excluded.unit_quantity, price = excluded.price, updated_at = CURRENT_TIMESTAMP
`;

/**
 * A Picnic product per open item of the menu's shopping list. Only the choice
 * is remembered: name, pack and price always come from Picnic as they are now.
 */
export async function suggestForMenu(menuId: number): Promise<Suggestion[]> {
  const db = getDb();
  const items = db.prepare(`
    SELECT id, item_name, quantity, product_group FROM shopping_items
    WHERE menu_id = ? AND checked = 0 ORDER BY product_group, item_name
  `).all(menuId) as ShoppingRow[];
  const inHouse = new Set((db.prepare('SELECT item_name FROM pantry_check WHERE menu_id = ? AND have_it = 1')
    .all(menuId) as Array<{ item_name: string }>).map((r) => itemKey(r.item_name)));
  const rememberedStmt = db.prepare('SELECT product_id, name FROM picnic_products WHERE item_key = ?');
  const remember = db.prepare(REMEMBER_SQL);

  return mapLimit(items, 4, async (item) => {
    const saved = rememberedStmt.get(itemKey(item.item_name)) as { product_id: string; name: string } | undefined;
    const hits = await searchProducts(item.item_name, 6);
    let product: PicnicProduct | null = hits[0] ?? null;
    let remembered = false;
    let previous: string | null = null;
    if (saved) {
      const fresh = hits.find((h) => sameProduct(h.id, saved.product_id)) ?? await currentProduct(saved.product_id);
      if (fresh) {
        product = fresh;
        remembered = true;
        remember.run(itemKey(item.item_name), fresh.id, fresh.name, fresh.unit_quantity, fresh.price);
      } else {
        previous = saved.name;
      }
    }
    return {
      item_id: item.id,
      item_name: item.item_name,
      quantity: item.quantity,
      product_group: item.product_group,
      product,
      remembered,
      previous,
      count: product ? counted(item, product).count : 1,
      selected: !!product && !isCupboardAmount(item.quantity) && !inHouse.has(itemKey(item.item_name)),
      alternatives: hits.map((h) => counted(item, h)),
    };
  });
}

export interface CartLine {
  item_id: number;
  product: PicnicProduct;
  count: number;
}

export interface AddResult {
  added: number;
  total_count: number;
  total_price: number;
  /** Items that did not make it into the basket; they stay open on the list. */
  missing: string[];
}

/** How many of each product (keyed without the "s" prefix) the basket holds. */
export function cartCounts(cart: PicnicCart): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of cart.items ?? []) {
    for (const article of line.items ?? []) {
      const n = article.decorators?.find((d) => d.type === 'QUANTITY')?.quantity ?? 1;
      counts.set(productKey(article.id), (counts.get(productKey(article.id)) ?? 0) + n);
    }
  }
  return counts;
}

function totalsPerProduct(lines: CartLine[]): Map<string, { id: string; quantity: number }> {
  const totals = new Map<string, { id: string; quantity: number }>();
  for (const l of lines) {
    const key = productKey(l.product.id);
    const t = totals.get(key) ?? { id: l.product.id, quantity: 0 };
    t.quantity += l.count;
    totals.set(key, t);
  }
  return totals;
}

/** Which lines' products grew by at least what was asked between two looks at the basket. */
function landedLines(lines: CartLine[], before: Map<string, number>, after: Map<string, number>) {
  const totals = totalsPerProduct(lines);
  const ok = (l: CartLine) => {
    const key = productKey(l.product.id);
    return (after.get(key) ?? 0) - (before.get(key) ?? 0) >= totals.get(key)!.quantity;
  };
  return { landed: lines.filter(ok), remaining: lines.filter((l) => !ok(l)) };
}

// An add that is still running, or whose outcome is unknown, holds its items this long
const CLAIM_MINUTES = 15;
// After this long an add still marked as running was cut off (restart) and is looked into again
const STALE_SECONDS = 120;

interface AddRow {
  request_id: string;
  menu_id: number;
  lines: string;
  before: string | null;
  state: 'pending' | 'uncertain' | 'done';
  result: string | null;
  age: number;
}

function getAdd(requestId: string): AddRow | undefined {
  return getDb().prepare(`
    SELECT *, CAST((julianday('now') - julianday(updated_at)) * 86400 AS INTEGER) AS age
    FROM picnic_adds WHERE request_id = ?
  `).get(requestId) as AddRow | undefined;
}

function setAdd(requestId: string, fields: { state?: AddRow['state']; before?: Map<string, number>; result?: AddResult }) {
  getDb().prepare(`
    UPDATE picnic_adds SET state = COALESCE(?, state), before = COALESCE(?, before),
      result = COALESCE(?, result), updated_at = CURRENT_TIMESTAMP
    WHERE request_id = ?
  `).run(
    fields.state ?? null,
    fields.before ? JSON.stringify([...fields.before]) : null,
    fields.result ? JSON.stringify(fields.result) : null,
    requestId,
  );
}

const dropAdd = (requestId: string) => getDb().prepare('DELETE FROM picnic_adds WHERE request_id = ?').run(requestId);

/**
 * Check and hold the items for this add, in one go: they belong to the menu,
 * are not ticked off yet, and no other add (another tab) is busy with them.
 */
function claim(menuId: number, requestId: string, lines: CartLine[]) {
  const db = getDb();
  db.transaction(() => {
    const rows = db.prepare('SELECT id, item_name, checked FROM shopping_items WHERE menu_id = ?')
      .all(menuId) as Array<{ id: number; item_name: string; checked: number }>;
    const byId = new Map(rows.map((r) => [r.id, r]));
    if (lines.some((l) => !byId.has(l.item_id))) throw new PicnicStateError('Boodschap hoort niet bij dit menu');
    const done = lines.filter((l) => byId.get(l.item_id)!.checked).map((l) => byId.get(l.item_id)!.item_name);
    if (done.length) {
      throw new PicnicStateError(`Staat al in het mandje: ${done.join(', ')}. Ververs de pagina.`);
    }
    const busy = new Set((db.prepare(`
      SELECT json_extract(j.value, '$.item_id') AS item_id FROM picnic_adds a, json_each(a.lines) j
      WHERE a.menu_id = ? AND a.state != 'done' AND a.updated_at > datetime('now', ?)
    `).all(menuId, `-${CLAIM_MINUTES} minutes`) as Array<{ item_id: number }>).map((r) => r.item_id));
    if (lines.some((l) => busy.has(l.item_id))) {
      throw new PicnicStateError('Deze boodschappen worden al toegevoegd, misschien in een ander venster. Ververs de pagina.');
    }
    db.prepare("INSERT INTO picnic_adds (request_id, menu_id, lines, state) VALUES (?, ?, ?, 'pending')")
      .run(requestId, menuId, JSON.stringify(lines));
  })();
}

/** Remember each choice and tick the items off. */
function finish(menuId: number, lines: CartLine[]) {
  const db = getDb();
  const remember = db.prepare(REMEMBER_SQL);
  const tick = db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = ? AND menu_id = ?');
  const name = db.prepare('SELECT item_name FROM shopping_items WHERE id = ?');
  for (const l of lines) {
    const row = name.get(l.item_id) as { item_name: string } | undefined;
    if (row) remember.run(itemKey(row.item_name), l.product.id, l.product.name, l.product.unit_quantity, l.product.price);
    tick.run(l.item_id, menuId);
  }
}

/**
 * Put the chosen products in the Picnic basket (added to what is there
 * already), remember each choice for its item, and tick the items off.
 *
 * Adding is not idempotent at Picnic, so each attempt carries a request id.
 * The same id again returns the first outcome, or, when that outcome was
 * unknown, first looks in the basket and only adds what is not there yet. A
 * failed add is never taken at its word either: Picnic may have filled the
 * basket and only failed to answer, so the basket is read again and compared.
 */
export async function addToCart(menuId: number, requestId: string, lines: CartLine[]): Promise<AddResult> {
  const prior = getAdd(requestId);
  if (prior) {
    if (prior.menu_id !== menuId) throw new PicnicStateError('Verzoek hoort bij een ander menu');
    if (prior.state === 'done') return JSON.parse(prior.result!) as AddResult;
    if (prior.state === 'pending' && prior.age < STALE_SECONDS) {
      throw new PicnicStateError('Bezig met toevoegen, even geduld.');
    }
    // What the first attempt sent counts, not what the page sends now
    lines = JSON.parse(prior.lines) as CartLine[];
    setAdd(requestId, { state: 'pending' });
  } else {
    claim(menuId, requestId, lines);
  }
  const db = getDb();
  const earlier = prior?.before ? new Map(JSON.parse(prior.before) as Array<[string, number]>) : null;

  let landed: CartLine[] = [];
  let remaining = lines;
  let cart: PicnicCart;
  try {
    cart = await withClient((c) => c.cart.getCart());
    if (earlier) ({ landed, remaining } = landedLines(lines, earlier, cartCounts(cart)));
  } catch (err) {
    // Nothing was sent this time; an earlier unknown outcome stays unknown
    if (prior) setAdd(requestId, { state: 'uncertain' });
    else dropAdd(requestId);
    throw err;
  }

  if (remaining.length) {
    const before = cartCounts(cart);
    setAdd(requestId, { before });
    try {
      cart = await withClient((c) => c.cart.addProductsToCart(
        [...totalsPerProduct(remaining).values()].map(({ id, quantity }) => ({ productId: id, quantity })),
      ));
      landed = [...landed, ...remaining];
      remaining = [];
    } catch (err) {
      if (err instanceof PicnicAuthError) {
        // Turned away at the door: nothing went in
        db.transaction(() => {
          finish(menuId, landed);
          if (landed.length) setAdd(requestId, { state: 'uncertain' });
          else dropAdd(requestId);
        })();
        throw err;
      }
      try {
        cart = await withClient((c) => c.cart.getCart());
      } catch {
        db.transaction(() => {
          finish(menuId, landed);
          setAdd(requestId, { state: 'uncertain' });
        })();
        throw new PicnicUncertainError(
          'Picnic gaf geen duidelijk antwoord. Probeer het opnieuw: dan wordt eerst in het mandje gekeken wat er al in zit.',
        );
      }
      const check = landedLines(remaining, before, cartCounts(cart));
      landed = [...landed, ...check.landed];
      remaining = check.remaining;
      if (!landed.length) {
        dropAdd(requestId); // the basket shows nothing went in: safe to try again
        throw err;
      }
    }
  }

  const missingIds = new Set(remaining.map((l) => l.item_id));
  const nameOf = db.prepare('SELECT item_name FROM shopping_items WHERE id = ?');
  const result: AddResult = {
    added: landed.length,
    total_count: cart.total_count,
    total_price: cart.total_price,
    missing: [...missingIds].map((id) => (nameOf.get(id) as { item_name: string } | undefined)?.item_name ?? String(id)),
  };
  db.transaction(() => {
    finish(menuId, landed);
    setAdd(requestId, { state: 'done', result });
  })();
  return result;
}
