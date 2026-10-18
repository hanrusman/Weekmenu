import crypto from 'crypto';
import PicnicClient from 'picnic-api';
import { getDb } from '../db.js';
import { normalizeUnit, parseAmount } from './ingredients.js';
import { defaultFactor } from './piece-weights.js';
import { Candidate, ItemWish, frozenMismatch, itemWish, productFacts, rank } from './picnic-preferences.js';

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
  /** What the search said about it, to show and to choose by; absent for products from elsewhere. */
  frozen?: boolean;
  organic?: boolean;
  house_brand?: boolean;
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
    search(query: string): Promise<Array<{ id: string; name: string; unit_quantity?: string; display_price?: number; decorators?: unknown[] }>>;
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
    const facts = productFacts(r);
    products.push({
      id: r.id,
      name: r.name,
      unit_quantity: r.unit_quantity ?? null,
      price: typeof r.display_price === 'number' ? r.display_price : null,
      frozen: facts.frozen,
      organic: facts.organic,
      house_brand: facts.houseBrand,
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
  const need = neededIn(quantity, pack.measure, itemName);
  if (need <= 0) return 1;
  return Math.min(max, Math.max(1, Math.ceil(need / pack.amount - 0.1)));
}

/**
 * How much is left over with this product's packs, relative to what is
 * needed (0.5 = half as much again); null when it cannot be compared.
 */
export function leftOver(quantity: string | null, unitQuantity: string | null, itemName: string): number | null {
  const pack = packSize(unitQuantity);
  if (!pack || !quantity) return null;
  const need = neededIn(quantity, pack.measure, itemName);
  if (need <= 0) return null;
  const packs = packsNeeded(quantity, unitQuantity, itemName);
  return Math.max(0, (packs * pack.amount - need) / need);
}

/** A shopping-list quantity in one measure; 0 when none of it converts. */
function neededIn(quantity: string, measure: Measure, itemName: string): number {
  let need = 0;
  for (const part of quantity.split(',')) {
    const m = part.trim().match(/^(\S+)\s*(.*)$/);
    if (!m) continue;
    const amount = parseAmount(m[1]);
    if (amount === null) continue;
    const own = measureOf(m[2] || 'stuks');
    if (own) {
      if (own.measure === measure) {
        need += amount * own.factor;
        continue;
      }
      const factor = defaultFactor(itemName, own.measure, measure);
      if (factor !== undefined) need += amount * own.factor * factor;
      continue;
    }
    const n = normalizeUnit(m[2]);
    const factor = defaultFactor(itemName, n.unit, measure);
    if (factor !== undefined) need += amount * n.factor * factor;
  }
  return need;
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

/** The facts a product carries, or what its name says when it came from elsewhere. */
const factsOf = (p: PicnicProduct) => (p.frozen === undefined
  ? productFacts(p)
  : { frozen: !!p.frozen, organic: !!p.organic, houseBrand: !!p.house_brand });

/** Products for an item, best fit by Han's preferences first, each with its pack count. */
function rankFor(item: ShoppingRow, wish: ItemWish, products: PicnicProduct[]): CountedProduct[] {
  const candidates: Candidate<PicnicProduct>[] = products.map((p) => ({
    product: p,
    facts: factsOf(p),
    waste: leftOver(item.quantity, p.unit_quantity, item.item_name),
  }));
  return rank(wish, candidates).map((c) => counted(item, c.product));
}

/** Search hits for one shopping item, best fit first, each with the packs it would take. */
export async function searchForItem(itemId: number, query: string): Promise<CountedProduct[]> {
  const item = shoppingItem(itemId);
  if (!item) throw new PicnicStateError('Boodschap niet gevonden');
  return rankFor(item, itemWish(item.item_name, item.product_group, item.quantity), await searchProducts(query));
}

/**
 * Current name, pack and price of a product by id; null when Picnic no longer
 * has it. An expired login still counts as an error.
 */
async function currentProduct(id: string): Promise<PicnicProduct | null> {
  try {
    const d = await withClient((c) => c.catalog.getProductDetails(id));
    const name = d.brand && !d.name.toLowerCase().startsWith(d.brand.toLowerCase()) ? `${d.brand} ${d.name}` : d.name;
    const facts = productFacts({ name });
    return {
      id, name, unit_quantity: d.unitQuantity || null, price: Number.isFinite(d.displayPrice) ? d.displayPrice : null,
      frozen: facts.frozen, organic: facts.organic, house_brand: facts.houseBrand,
    };
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
  /** That product was picked by hand ("Ander product"), so it is kept whatever ranks first. */
  picked: boolean;
  /** The product chosen before when Picnic no longer has it; product is then a replacement. */
  previous: string | null;
  count: number;
  /** Proposed to go in the basket; off for cupboard staples, what is in the house and what comes from elsewhere. */
  selected: boolean;
  /** Why it is off, or what to look at (only frozen found, last time's product was frozen). */
  note: string | null;
  /** Search hits to pick from instead, best fit first, each with its own pack count. */
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
  INSERT INTO picnic_products (item_key, product_id, name, unit_quantity, price, picked, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(item_key) DO UPDATE SET product_id = excluded.product_id, name = excluded.name,
    unit_quantity = excluded.unit_quantity, price = excluded.price,
    -- A hand pick stays one when the same product is accepted again
    picked = CASE WHEN excluded.picked = 1 OR excluded.product_id = picnic_products.product_id
      THEN MAX(excluded.picked, picnic_products.picked) ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP
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
  const rememberedStmt = db.prepare('SELECT product_id, name, picked FROM picnic_products WHERE item_key = ?');
  const refresh = db.prepare(`
    UPDATE picnic_products SET name = ?, unit_quantity = ?, price = ?, updated_at = CURRENT_TIMESTAMP WHERE item_key = ?
  `);

  return mapLimit(items, 4, async (item) => {
    const wish = itemWish(item.item_name, item.product_group, item.quantity);
    const saved = rememberedStmt.get(itemKey(item.item_name)) as { product_id: string; name: string; picked: number } | undefined;
    let hits = await searchProducts(item.item_name, 10);
    // Fresh wanted but Picnic shows only frozen: ask for fresh by name
    if (wish.frozen === false && hits.length > 0 && hits.every((h) => h.frozen)) {
      const fresh = await searchProducts(`${item.item_name} vers`, 10);
      hits = [...fresh, ...hits.filter((h) => !fresh.some((f) => sameProduct(f.id, h.id)))];
    }
    const ranked = rankFor(item, wish, hits);
    let product: PicnicProduct | null = ranked[0] ?? null;
    let remembered = false;
    let previous: string | null = null;
    let note: string | null = null;
    if (saved && !saved.picked && product) {
      // Only accepted as proposed: weighed again, so a better rule or product can take over
      remembered = sameProduct(product.id, saved.product_id);
    } else if (saved) {
      const current = hits.find((h) => sameProduct(h.id, saved.product_id)) ?? await currentProduct(saved.product_id);
      if (current && !frozenMismatch(wish, factsOf(current))) {
        product = current;
        remembered = true;
        refresh.run(current.name, current.unit_quantity, current.price, itemKey(item.item_name));
      } else if (current) {
        note = `vorige keer ${saved.name}, maar dat is ${factsOf(current).frozen ? 'diepvries' : 'vers'}`;
      } else {
        previous = saved.name;
      }
    }
    const mismatch = !!product && frozenMismatch(wish, factsOf(product));
    if (mismatch) note = wish.frozen ? 'alleen vers gevonden' : 'alleen diepvries gevonden, kijk even na';
    const off = !product ? null
      : wish.elsewhere
        ?? (inHouse.has(itemKey(item.item_name)) ? 'in huis volgens de voorraadcheck' : null)
        ?? (isCupboardAmount(item.quantity) ? 'voorraadkast' : null);
    return {
      item_id: item.id,
      item_name: item.item_name,
      quantity: item.quantity,
      product_group: item.product_group,
      product,
      remembered,
      picked: remembered && !!saved?.picked,
      previous,
      count: product ? counted(item, product).count : 1,
      selected: !!product && !off && !mismatch,
      note: off ?? note,
      alternatives: ranked.slice(0, 6),
    };
  });
}

export interface CartLine {
  item_id: number;
  product: PicnicProduct;
  count: number;
  /** Picked by hand rather than accepted as proposed. */
  picked?: boolean;
}

export interface AddResult {
  added: number;
  total_count: number;
  total_price: number;
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

/**
 * Per product of an attempt: how many were asked for, and how many the basket
 * held just before the first time this attempt sent it. That starting point is
 * kept for the life of the attempt, so whatever the basket holds above it went
 * in through this attempt, however many tries and failures it took.
 */
interface ProductProgress {
  id: string;
  name: string;
  want: number;
  baseline: number | null;
}

type Progress = Record<string, ProductProgress>;

function initialProgress(lines: CartLine[]): Progress {
  const progress: Progress = {};
  for (const l of lines) {
    const key = productKey(l.product.id);
    progress[key] ??= { id: l.product.id, name: l.product.name, want: 0, baseline: null };
    progress[key].want += l.count;
  }
  return progress;
}

/** What of a product is in the basket through this attempt (never more than asked). */
function landed(p: ProductProgress, now: Map<string, number>): number {
  if (p.baseline === null) return 0;
  return Math.min(p.want, Math.max(0, (now.get(productKey(p.id)) ?? 0) - p.baseline));
}

/** The lines the landed packs fully cover, in order, when several items share a product. */
function coveredLines(lines: CartLine[], progress: Progress, now: Map<string, number>): CartLine[] {
  const left = new Map(Object.entries(progress).map(([key, p]) => [key, landed(p, now)]));
  return lines.filter((l) => {
    const key = productKey(l.product.id);
    const available = left.get(key) ?? 0;
    if (available < l.count) return false;
    left.set(key, available - l.count);
    return true;
  });
}

interface AddRow {
  request_id: string;
  menu_id: number;
  lines: string;
  progress: string;
  state: 'open' | 'done';
  result: string | null;
}

/** Attempts this process is talking to Picnic about right now. */
const inFlight = new Set<string>();

function getAdd(requestId: string): AddRow | undefined {
  return getDb().prepare('SELECT * FROM picnic_adds WHERE request_id = ?').get(requestId) as AddRow | undefined;
}

function saveProgress(requestId: string, progress: Progress) {
  getDb().prepare('UPDATE picnic_adds SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE request_id = ?')
    .run(JSON.stringify(progress), requestId);
}

const dropAdd = (requestId: string) => getDb().prepare('DELETE FROM picnic_adds WHERE request_id = ?').run(requestId);

const itemNames = (ids: number[]) => {
  const stmt = getDb().prepare('SELECT item_name FROM shopping_items WHERE id = ?');
  return ids.map((id) => (stmt.get(id) as { item_name: string } | undefined)?.item_name ?? String(id));
};

export interface Unfinished {
  request_id: string;
  /** The open items it holds. */
  items: string[];
}

/** Attempts on this menu that have not been settled; they hold their items until they are. */
export function unfinishedFor(menuId: number): Unfinished[] {
  const rows = getDb().prepare("SELECT request_id, lines FROM picnic_adds WHERE menu_id = ? AND state = 'open' ORDER BY updated_at")
    .all(menuId) as Array<{ request_id: string; lines: string }>;
  const open = getDb().prepare('SELECT checked FROM shopping_items WHERE id = ?');
  return rows.map((r) => ({
    request_id: r.request_id,
    items: itemNames((JSON.parse(r.lines) as CartLine[])
      .filter((l) => !(open.get(l.item_id) as { checked: number } | undefined)?.checked)
      .map((l) => l.item_id)),
  }));
}

/**
 * Check and hold the items for a new attempt, in one go: they belong to the
 * menu, are not ticked off yet, and no unsettled attempt holds them. An
 * unsettled attempt keeps its items however long ago it was: only settling it
 * (finish or abandon, both after a look in the basket) lets them go.
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
    const held = new Set((db.prepare(`
      SELECT json_extract(j.value, '$.item_id') AS item_id FROM picnic_adds a, json_each(a.lines) j
      WHERE a.menu_id = ? AND a.state = 'open'
    `).all(menuId) as Array<{ item_id: number }>).map((r) => r.item_id));
    if (lines.some((l) => held.has(l.item_id))) {
      throw new PicnicStateError('Een eerdere poging met deze boodschappen is nog niet afgerond. Ververs de pagina om die eerst af te ronden.');
    }
    db.prepare("INSERT INTO picnic_adds (request_id, menu_id, lines, progress, state) VALUES (?, ?, ?, ?, 'open')")
      .run(requestId, menuId, JSON.stringify(lines), JSON.stringify(initialProgress(lines)));
  })();
}

/** Remember each choice and tick the items off. */
function finish(menuId: number, lines: CartLine[]) {
  const db = getDb();
  const remember = db.prepare(REMEMBER_SQL);
  const tick = db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = ? AND menu_id = ?');
  const name = db.prepare('SELECT item_name FROM shopping_items WHERE id = ?');
  // Two items with the same name share one memory: a hand pick among them wins
  const pickedKeys = new Set(lines.filter((l) => l.picked).map((l) => (name.get(l.item_id) as { item_name: string } | undefined)?.item_name)
    .filter((n): n is string => !!n).map(itemKey));
  for (const l of lines) {
    const row = name.get(l.item_id) as { item_name: string } | undefined;
    if (row && (l.picked || !pickedKeys.has(itemKey(row.item_name)))) {
      remember.run(itemKey(row.item_name), l.product.id, l.product.name, l.product.unit_quantity, l.product.price, l.picked ? 1 : 0);
    }
    tick.run(l.item_id, menuId);
  }
}

interface Settled {
  result: AddResult | null;
  /** Products not (fully) in the basket: name, how many are, how many were asked. */
  short: Array<{ name: string; have: number; want: number }>;
  /** Items left open. */
  open: string[];
}

/**
 * Look in the basket and bring an attempt up to date: tick off the items whose
 * packs are all in, and with send, add exactly what is still missing per
 * product. Picnic's word on a failed add is never taken: the basket is read
 * again. When it cannot be read, the attempt stays open, holding its items.
 */
async function settle(requestId: string, send: boolean): Promise<Settled> {
  if (inFlight.has(requestId)) throw new PicnicStateError('Bezig met toevoegen, even geduld.');
  inFlight.add(requestId);
  try {
    const row = getAdd(requestId)!;
    const lines = JSON.parse(row.lines) as CartLine[];
    const progress = JSON.parse(row.progress) as Progress;
    const sentBefore = Object.values(progress).some((p) => p.baseline !== null);

    let cart: PicnicCart;
    try {
      cart = await withClient((c) => c.cart.getCart());
    } catch (err) {
      if (!sentBefore && send) dropAdd(requestId); // nothing ever went out: no need to hold the items
      throw err;
    }
    let now = cartCounts(cart);

    if (send) {
      const toSend = Object.values(progress)
        .map((p) => ({ p, missing: p.want - landed(p, now) }))
        .filter((x) => x.missing > 0);
      if (toSend.length) {
        for (const { p } of toSend) p.baseline ??= now.get(productKey(p.id)) ?? 0;
        saveProgress(requestId, progress); // before anything goes out
        try {
          cart = await withClient((c) => c.cart.addProductsToCart(
            toSend.map(({ p, missing }) => ({ productId: p.id, quantity: missing })),
          ));
          // Picnic took it: count it in, whatever else changes in the basket meanwhile
          now = new Map(now);
          for (const { p, missing } of toSend) now.set(productKey(p.id), (now.get(productKey(p.id)) ?? 0) + missing);
        } catch (err) {
          if (err instanceof PicnicAuthError) throw err; // turned away; the next try looks in the basket again
          try {
            cart = await withClient((c) => c.cart.getCart());
            now = cartCounts(cart);
          } catch {
            throw new PicnicUncertainError(
              'Picnic gaf geen duidelijk antwoord. Met Afronden wordt eerst in het mandje gekeken wat er al in zit.',
            );
          }
        }
      }
    }

    const covered = coveredLines(lines, progress, now);
    const coveredIds = new Set(covered.map((l) => l.item_id));
    const short = Object.values(progress)
      .filter((p) => landed(p, now) < p.want)
      .map((p) => ({ name: p.name, have: landed(p, now), want: p.want }));
    const result: AddResult | null = short.length
      ? null
      : { added: lines.length, total_count: cart.total_count, total_price: cart.total_price };
    getDb().transaction(() => {
      finish(row.menu_id, covered);
      if (result) {
        getDb().prepare("UPDATE picnic_adds SET state = 'done', result = ?, updated_at = CURRENT_TIMESTAMP WHERE request_id = ?")
          .run(JSON.stringify(result), requestId);
      }
    })();
    return { result, short, open: itemNames(lines.filter((l) => !coveredIds.has(l.item_id)).map((l) => l.item_id)) };
  } finally {
    inFlight.delete(requestId);
  }
}

const describeShort = (short: Settled['short']) =>
  short.map((s) => (s.have ? `${s.name} (${s.have} van ${s.want})` : s.name)).join(', ');

/**
 * Put the chosen products in the Picnic basket (added to what is there
 * already), remember each choice for its item, and tick the items off.
 *
 * Adding is not idempotent at Picnic, so each attempt carries a request id.
 * The same id again returns the outcome, or carries on where the attempt
 * stands: it only sends what the basket shows is still missing, per product.
 */
export async function addToCart(menuId: number, requestId: string, lines: CartLine[]): Promise<AddResult> {
  const prior = getAdd(requestId);
  if (prior) {
    if (prior.menu_id !== menuId) throw new PicnicStateError('Verzoek hoort bij een ander menu');
    // The attempt goes on with what it was started with; a changed choice under the same id
    // would silently be ignored, so it is refused instead
    if (choiceOf(JSON.parse(prior.lines) as CartLine[]) !== choiceOf(lines)) {
      throw new PicnicStateError('Deze poging is begonnen met een andere keuze. Rond die eerst af of breek haar af.');
    }
    if (prior.state === 'done') return JSON.parse(prior.result!) as AddResult;
  } else {
    claim(menuId, requestId, lines);
  }
  return settleAndAdd(requestId);
}

/** A choice as text, to tell whether two attempts asked the same: item, product, packs. */
function choiceOf(lines: CartLine[]): string {
  return lines.map((l) => `${l.item_id}:${productKey(l.product.id)}:${l.count}`).sort().join(',');
}

async function settleAndAdd(requestId: string): Promise<AddResult> {
  const settled = await settle(requestId, true);
  if (settled.result) return settled.result;
  throw new PicnicStateError(
    `Niet (helemaal) in het mandje gekomen: ${describeShort(settled.short)}. Met Afronden gaat alleen wat ontbreekt.`,
  );
}

/** Carry on with an unsettled attempt, from wherever the basket says it stands. */
export async function finishAttempt(menuId: number, requestId: string): Promise<AddResult> {
  const prior = getAdd(requestId);
  if (!prior || prior.menu_id !== menuId) throw new PicnicStateError('Deze poging bestaat niet (meer)');
  if (prior.state === 'done') return JSON.parse(prior.result!) as AddResult;
  return settleAndAdd(requestId);
}

/**
 * Give an unsettled attempt up: tick off what the basket shows went in and
 * let the rest go, saying what of it is partly in the basket. Needs a look in
 * the basket, so it stays unsettled while Picnic cannot be reached.
 */
export async function abandonAttempt(menuId: number, requestId: string): Promise<{ open: string[]; partly: string }> {
  const prior = getAdd(requestId);
  if (!prior || prior.menu_id !== menuId) throw new PicnicStateError('Deze poging bestaat niet (meer)');
  if (prior.state === 'done') return { open: [], partly: '' };
  const settled = await settle(requestId, false);
  dropAdd(requestId);
  return { open: settled.open, partly: describeShort(settled.short.filter((s) => s.have > 0)) };
}
