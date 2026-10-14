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
  };
  cart: {
    addProductsToCart(products: Array<{ productId: string; quantity: number }>): Promise<{ total_count: number; total_price: number }>;
  };
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
/** Something the person has to fix (no account, wrong code). */
export class PicnicStateError extends Error {}

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

export interface Suggestion {
  item_id: number;
  item_name: string;
  quantity: string | null;
  product_group: string;
  product: PicnicProduct | null;
  /** The product chosen for this item before. */
  remembered: boolean;
  count: number;
  /** Proposed to go in the basket; off for cupboard staples and what is in the house. */
  selected: boolean;
  /** Other search hits to pick from, for items without a remembered product. */
  alternatives: PicnicProduct[];
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

/** A Picnic product per open item of the menu's shopping list. */
export async function suggestForMenu(menuId: number): Promise<Suggestion[]> {
  const db = getDb();
  const items = db.prepare(`
    SELECT id, item_name, quantity, product_group FROM shopping_items
    WHERE menu_id = ? AND checked = 0 ORDER BY product_group, item_name
  `).all(menuId) as Array<{ id: number; item_name: string; quantity: string | null; product_group: string }>;
  const inHouse = new Set((db.prepare('SELECT item_name FROM pantry_check WHERE menu_id = ? AND have_it = 1')
    .all(menuId) as Array<{ item_name: string }>).map((r) => itemKey(r.item_name)));
  const rememberedStmt = db.prepare('SELECT product_id, name, unit_quantity, price FROM picnic_products WHERE item_key = ?');

  return mapLimit(items, 4, async (item) => {
    const saved = rememberedStmt.get(itemKey(item.item_name)) as
      { product_id: string; name: string; unit_quantity: string | null; price: number | null } | undefined;
    let product: PicnicProduct | null = saved
      ? { id: saved.product_id, name: saved.name, unit_quantity: saved.unit_quantity, price: saved.price }
      : null;
    let alternatives: PicnicProduct[] = [];
    if (!product) {
      alternatives = await searchProducts(item.item_name, 6);
      product = alternatives[0] ?? null;
    }
    return {
      item_id: item.id,
      item_name: item.item_name,
      quantity: item.quantity,
      product_group: item.product_group,
      product,
      remembered: !!saved,
      count: product ? packsNeeded(item.quantity, product.unit_quantity, item.item_name) : 1,
      selected: !!product && !isCupboardAmount(item.quantity) && !inHouse.has(itemKey(item.item_name)),
      alternatives,
    };
  });
}

export interface CartLine {
  item_id: number;
  product: PicnicProduct;
  count: number;
}

/**
 * Put the chosen products in the Picnic basket (added to what is there
 * already), remember each choice for its item, and tick the items off.
 */
export async function addToCart(menuId: number, lines: CartLine[]): Promise<{ added: number; total_count: number; total_price: number }> {
  const db = getDb();
  const names = new Map((db.prepare('SELECT id, item_name FROM shopping_items WHERE menu_id = ?')
    .all(menuId) as Array<{ id: number; item_name: string }>).map((r) => [r.id, r.item_name]));
  const unknown = lines.find((l) => !names.has(l.item_id));
  if (unknown) throw new PicnicStateError('Boodschap hoort niet bij dit menu');

  // One request per product; several items can map to the same product
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.product.id, (totals.get(l.product.id) ?? 0) + l.count);
  const cart = await withClient((c) => c.cart.addProductsToCart(
    [...totals].map(([productId, quantity]) => ({ productId, quantity })),
  ));

  const remember = db.prepare(`
    INSERT INTO picnic_products (item_key, product_id, name, unit_quantity, price, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(item_key) DO UPDATE SET product_id = excluded.product_id, name = excluded.name,
      unit_quantity = excluded.unit_quantity, price = excluded.price, updated_at = CURRENT_TIMESTAMP
  `);
  const tick = db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = ? AND menu_id = ?');
  db.transaction(() => {
    for (const l of lines) {
      remember.run(itemKey(names.get(l.item_id)!), l.product.id, l.product.name, l.product.unit_quantity, l.product.price);
      tick.run(l.item_id, menuId);
    }
  })();

  return { added: lines.length, total_count: cart.total_count, total_price: cart.total_price };
}
