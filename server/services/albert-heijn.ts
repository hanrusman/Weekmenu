import { getDb } from '../db.js';
import type { AhProduct, AhSuggestion, AhCountedProduct, AhLine, AhAttempt, AhAddResult } from '../../shared/albert-heijn.js';
import { AhStateError, ahMemberId, connectAh, disconnectAh, getAhProduct, readAhList, searchAhProducts, setAhQuantities } from './ah-client.js';
import { itemWish, isRelevant, rank } from './picnic-preferences.js';
import { cupboardAmount, leftOver, packsNeeded } from './picnic.js';
import { searchQueries } from './picnic-preferences.js';

interface Item { id: number; item_name: string; quantity: string | null; product_group: string }
const key = (name: string) => name.trim().toLowerCase();
const itemById = (id: number) => getDb().prepare('SELECT id, item_name, quantity, product_group FROM shopping_items WHERE id = ?').get(id) as Item | undefined;
const counted = (item: Item, p: AhProduct): AhCountedProduct => ({ ...p, count: packsNeeded(item.quantity, p.unit_quantity, item.item_name) });

function rankFor(item: Item, products: AhProduct[]): AhCountedProduct[] {
  const wish = itemWish(item.item_name, item.product_group, item.quantity);
  const candidates = products.map(p => ({
    product: p, facts: { frozen: p.frozen ?? false, organic: p.organic, houseBrand: p.house_brand },
    waste: leftOver(item.quantity, p.unit_quantity, item.item_name),
    cost: p.price === null ? null : p.price * packsNeeded(item.quantity, p.unit_quantity, item.item_name),
  }));
  const fits = (p: AhProduct) => isRelevant(wish, p.name) && (wish.frozen === null || p.frozen === wish.frozen);
  // Rank appropriate products first; brand/price must never promote unknown or unsuitable ones.
  return rank(wish, candidates).map(c => counted(item, c.product)).sort((a, b) => Number(fits(b)) - Number(fits(a)));
}

export async function searchForAhItem(itemId: number, query: string) {
  const item = itemById(itemId);
  if (!item) throw new AhStateError('Boodschap niet gevonden.');
  return rankFor(item, await searchAhProducts(query));
}

function requireMenu(menuId: number) {
  if (!getDb().prepare('SELECT 1 FROM menus WHERE id = ?').get(menuId)) throw new AhStateError('Menu niet gevonden.');
}

/** Bound concurrency to three AH requests, including remembered products. */
export async function suggestForAhMenu(menuId: number): Promise<AhSuggestion[]> {
  requireMenu(menuId);
  const db = getDb();
  const items = db.prepare('SELECT id, item_name, quantity, product_group FROM shopping_items WHERE menu_id = ? AND checked = 0 ORDER BY product_group, item_name').all(menuId) as Item[];
  const pantry = new Set((db.prepare('SELECT item_name FROM pantry_check WHERE menu_id = ? AND have_it = 1').all(menuId) as Array<{ item_name: string }>).map(i => key(i.item_name)));
  const results: AhSuggestion[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      const wish = itemWish(item.item_name, item.product_group, item.quantity);
      let query = searchQueries(item.item_name)[0];
      const hits = new Map<string, AhProduct>();
      for (const q of searchQueries(item.item_name).slice(0, 4)) {
        query = q;
        for (const p of await searchAhProducts(q)) hits.set(p.id, p);
        if ([...hits.values()].some(p => isRelevant(wish, p.name) && (wish.frozen === null || p.frozen === wish.frozen))) break;
      }
      const saved = db.prepare('SELECT product_id, picked FROM ah_products WHERE item_key = ?').get(key(item.item_name)) as { product_id: string; picked: number } | undefined;
      let current: AhProduct | null = null;
      if (saved?.picked) {
        // Always read the actual remembered product, including its category. No shortlist bypass.
        current = await getAhProduct(saved.product_id);
        if (current) hits.set(current.id, current);
        else hits.delete(saved.product_id);
      }
      const alternatives = rankFor(item, [...hits.values()]);
      let product: AhProduct | null = alternatives[0] ?? null;
      if (current && (wish.frozen === null || current.frozen === wish.frozen)) product = current;
      const remembered = !!product && saved?.product_id === product.id;
      const off = wish.elsewhere ?? (pantry.has(key(item.item_name)) ? 'in huis volgens de voorraadcheck' : null) ?? cupboardAmount(item.quantity);
      const temperatureUnknown = !!product && wish.frozen !== null && product.frozen === null;
      const mismatch = !!product && wish.frozen !== null && product.frozen !== wish.frozen;
      const unsure = !!product && !(remembered && saved?.picked) && !isRelevant(wish, product.name);
      const note = off ?? (temperatureUnknown ? 'vers of diepvries onbekend, kijk even na'
        : mismatch ? `alleen ${product?.frozen ? 'diepvries' : 'vers'} gevonden, kijk even na`
          : unsure ? 'geen passend product gevonden, kies zelf een product' : null);
      results[index] = {
        item_id: item.id, item_name: item.item_name, quantity: item.quantity, product_group: item.product_group,
        query, product, remembered, picked: remembered && !!saved?.picked,
        count: product ? counted(item, product).count : 1, selected: !!product && !off && !mismatch && !unsure,
        note, alternatives: alternatives.slice(0, 8),
      };
    }
  }));
  return results;
}

interface Target { id: string; name: string; baseline: number; quantity: number }
interface AttemptRow {
  request_id: string; menu_id: number; member_id: string; lines: string;
  targets: string | null; state: 'open' | 'done' | 'abandoned';
}
const attemptById = (id: string) => getDb().prepare('SELECT * FROM ah_adds WHERE request_id = ?').get(id) as AttemptRow | undefined;
export function unfinishedAh(): AhAttempt[] {
  return (getDb().prepare("SELECT * FROM ah_adds WHERE state = 'open'").all() as AttemptRow[]).map(a => ({
    request_id: a.request_id, menu_id: a.menu_id,
    items: (JSON.parse(a.lines) as AhLine[]).map(l => itemById(l.item_id)?.item_name ?? l.product.name),
  }));
}

let writing = false;
async function exclusively<T>(action: () => Promise<T>): Promise<T> {
  if (writing) throw new AhStateError('Bezig met Albert Heijn, even geduld.');
  writing = true;
  try { return await action(); } finally { writing = false; }
}
export const connectAhAccount = (code: string) => exclusively(() => connectAh(code));
export const disconnectAhAccount = () => exclusively(async () => disconnectAh());

const choiceKey = (lines: AhLine[]) => lines.map(l => `${l.item_id}:${l.product.id}:${l.count}:${l.picked}`).sort().join(',');

function claim(menuId: number, requestId: string, lines: AhLine[]): AttemptRow {
  const db = getDb();
  return db.transaction(() => {
    const prior = attemptById(requestId);
    if (prior) {
      if (prior.menu_id !== menuId || choiceKey(JSON.parse(prior.lines)) !== choiceKey(lines))
        throw new AhStateError('Deze poging hoort bij een andere keuze. Rond de eerdere poging eerst af.');
      if (prior.state === 'abandoned') throw new AhStateError('Deze poging is afgebroken. Ververs de voorstellen.');
      return prior;
    }
    requireMenu(menuId);
    const memberId = ahMemberId();
    if (!memberId) throw new AhStateError('Koppel eerst Albert Heijn.');
    if (unfinishedAh().length) throw new AhStateError('Rond de eerdere AH-poging eerst af.');
    if (!lines.length || new Set(lines.map(l => l.item_id)).size !== lines.length) throw new AhStateError('Kies elke boodschap maximaal één keer.');
    const rows = db.prepare('SELECT id, checked FROM shopping_items WHERE menu_id = ?').all(menuId) as Array<{ id: number; checked: number }>;
    if (lines.some(l => !rows.some(r => r.id === l.item_id && !r.checked))) throw new AhStateError('Een boodschap is al afgevinkt of hoort niet bij deze week. Ververs de lijst.');
    const held = new Set((db.prepare(`SELECT json_extract(j.value, '$.item_id') AS item_id
      FROM picnic_adds a, json_each(a.lines) j WHERE a.state = 'open'`).all() as Array<{ item_id: number }>).map(r => r.item_id));
    if (lines.some(l => held.has(l.item_id))) throw new AhStateError('Rond de eerdere Picnic-poging met deze boodschappen eerst af.');
    db.prepare('INSERT INTO ah_adds (request_id, menu_id, member_id, lines) VALUES (?, ?, ?, ?)').run(requestId, menuId, memberId, JSON.stringify(lines));
    return attemptById(requestId)!;
  })();
}

function covered(lines: AhLine[], targets: Target[], now: Map<string, number>): AhLine[] {
  const remaining = new Map(targets.map(t => [t.id, Math.max(0, (now.get(t.id) ?? 0) - t.baseline)]));
  return lines.filter(l => {
    const n = remaining.get(l.product.id) ?? 0;
    if (n < l.count) return false;
    remaining.set(l.product.id, n - l.count);
    return true;
  });
}

function markCovered(menuId: number, lines: AhLine[]) {
  const db = getDb();
  const handPicked = new Set(lines.filter(l => l.picked).map(l => key(itemById(l.item_id)?.item_name ?? '')));
  for (const l of lines) {
    const item = itemById(l.item_id);
    if (item && (l.picked || !handPicked.has(key(item.item_name)))) {
      db.prepare(`INSERT INTO ah_products (item_key, product_id, picked) VALUES (?, ?, ?)
        ON CONFLICT(item_key) DO UPDATE SET product_id = excluded.product_id,
          picked = CASE WHEN excluded.product_id = ah_products.product_id THEN MAX(ah_products.picked, excluded.picked) ELSE excluded.picked END`)
        .run(key(item.item_name), l.product.id, l.picked ? 1 : 0);
    }
    db.prepare('UPDATE shopping_items SET checked = 1 WHERE id = ? AND menu_id = ?').run(l.item_id, menuId);
  }
}

async function settle(attempt: AttemptRow, mode: 'send' | 'abandon'): Promise<AhAddResult> {
  if (attempt.member_id !== ahMemberId()) throw new AhStateError('Koppel hetzelfde AH-account als bij de eerdere poging.');
  const lines: AhLine[] = JSON.parse(attempt.lines);
  if (attempt.state === 'done') return { added: lines.length };
  if (attempt.state !== 'open') throw new AhStateError('Deze poging is al afgebroken.');
  let targets: Target[] | null = attempt.targets ? JSON.parse(attempt.targets) : null;
  // No PATCH can have happened without persisted targets. An unreadable initial list is safe to retry.
  let now: Map<string, number>;
  try { now = await readAhList(); }
  catch (err) {
    if (!targets) getDb().prepare('DELETE FROM ah_adds WHERE request_id = ?').run(attempt.request_id);
    throw err;
  }
  if (!targets) {
    const byProduct = new Map<string, Target>();
    for (const l of lines) {
      const prior = byProduct.get(l.product.id);
      if (prior) prior.quantity += l.count;
      else byProduct.set(l.product.id, { id: l.product.id, name: l.product.name, baseline: now.get(l.product.id) ?? 0, quantity: (now.get(l.product.id) ?? 0) + l.count });
    }
    targets = [...byProduct.values()];
    getDb().prepare('UPDATE ah_adds SET targets = ? WHERE request_id = ?').run(JSON.stringify(targets), attempt.request_id);
  }
  if (mode === 'send') {
    if (targets.some(t => (now.get(t.id) ?? 0) < t.baseline))
      throw new AhStateError('De AH-lijst is ondertussen aangepast. Breek deze poging af en bekijk de voorstellen opnieuw.');
    const missing = targets.filter(t => (now.get(t.id) ?? 0) < t.quantity);
    if (missing.length) {
      // Persisted absolute targets make a retry safe, including after a lost response or process restart.
      try { await setAhQuantities(missing); }
      catch { /* Read back even after an error: AH may already have applied all or part of the PATCH. */ }
      now = await readAhList();
    }
  }
  const done = covered(lines, targets, now);
  const complete = done.length === lines.length;
  getDb().transaction(() => {
    markCovered(attempt.menu_id, done);
    if (complete || mode === 'abandon') getDb().prepare('UPDATE ah_adds SET state = ? WHERE request_id = ?')
      .run(complete ? 'done' : 'abandoned', attempt.request_id);
  })();
  if (!complete && mode === 'send') throw new AhStateError('Nog niet alles staat op de AH-lijst. Met Afronden wordt de lijst eerst gecontroleerd en alleen het ontbrekende aangevuld.');
  const partly = targets.flatMap(t => {
    const added = Math.max(0, (now.get(t.id) ?? 0) - t.baseline);
    const assigned = done.filter(l => l.product.id === t.id).reduce((n, l) => n + l.count, 0);
    return added > assigned && added < t.quantity - t.baseline ? [`${t.name}: ${added - assigned} verpakking(en)`] : [];
  });
  return { added: done.length, ...(partly.length ? { partly } : {}) };
}

export const addToAhList = (menuId: number, requestId: string, lines: AhLine[]) =>
  exclusively(() => settle(claim(menuId, requestId, lines), 'send'));

export function settleAhAttempt(menuId: number, requestId: string, abandon = false) {
  return exclusively(async () => {
    const attempt = attemptById(requestId);
    if (!attempt || attempt.menu_id !== menuId) throw new AhStateError('Deze poging bestaat niet.');
    return settle(attempt, abandon ? 'abandon' : 'send');
  });
}
