import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test-picnic.db');
process.env.DATABASE_PATH = TEST_DB_PATH;

const { getDb, closeDb } = await import('../server/db');
const picnic = await import('../server/services/picnic');
type PicnicApi = import('../server/services/picnic').PicnicApi;

interface Fake {
  calls: string[];
  added: Array<Array<{ productId: string; quantity: number }>>;
  needs2fa: boolean;
  searchResults: Record<string, Array<{ id: string; name: string; unit_quantity?: string; display_price?: number }>>;
  /** Current details per product id; a product missing here is gone from Picnic. */
  details: Record<string, { name: string; brand: string | null; unitQuantity: string; displayPrice: number }>;
  failWith?: Error;
  /** How the next add goes: refused before anything changes, or done but the answer lost. */
  addFails?: 'refused' | 'answer-lost';
  /** Basket reads that fail from now on (the line went down). */
  cartReadsFail: boolean;
  /** Per coming basket read: true = it fails. Used up front to back, then reads work. */
  cartReadPlan: boolean[];
  /** Per coming add: how much of each product Picnic takes, and whether the answer gets lost. */
  addPlan: Array<{ take?: Record<string, number>; lost?: boolean }>;
  /** Product id -> how many are in the basket. */
  basket: Map<string, number>;
  created: Array<{ authKey?: string; deviceId: string }>;
}

let fake: Fake;
type Factory = Parameters<typeof picnic.setPicnicClientFactory>[0] & {};
let fakeFactory: Factory;
/** The fake as installed, to wrap with a failure for one test. */
const currentFactory = () => fakeFactory;

function basketView() {
  return {
    total_count: [...fake.basket.values()].reduce((a, b) => a + b, 0),
    total_price: 1234,
    // Cart lines carry the article id and its quantity in a decorator, like Picnic
    items: [...fake.basket].map(([id, quantity]) => ({
      items: [{ id, decorators: [{ type: 'PRICE' }, { type: 'QUANTITY', quantity }] }],
    })),
  };
}

function install() {
  fake = { calls: [], added: [], needs2fa: true, searchResults: {}, details: {}, cartReadsFail: false, cartReadPlan: [], addPlan: [], basket: new Map(), created: [] };
  fakeFactory = (options) => {
    fake.created.push(options);
    const client: PicnicApi = {
      authKey: options.authKey ?? null,
      auth: {
        async login(email) {
          fake.calls.push(`login ${email}`);
          client.authKey = 'pre-2fa-key';
          return { second_factor_authentication_required: fake.needs2fa };
        },
        async generate2FACode(channel) {
          fake.calls.push(`generate ${channel} ${client.authKey}`);
          return null;
        },
        async verify2FACode(code) {
          fake.calls.push(`verify ${code} ${client.authKey}`);
          return { authKey: 'full-key' };
        },
      },
      catalog: {
        async search(q) {
          if (fake.failWith) throw fake.failWith;
          fake.calls.push(`search ${q} ${client.authKey}`);
          return fake.searchResults[q] ?? [];
        },
        async getProductDetails(id) {
          if (fake.failWith) throw fake.failWith;
          fake.calls.push(`details ${id}`);
          const d = fake.details[id];
          if (!d) throw new Error('404 Not Found');
          return { id, ...d };
        },
      },
      cart: {
        async getCart() {
          if (fake.failWith) throw fake.failWith;
          if (fake.cartReadsFail || fake.cartReadPlan.shift()) throw new Error('fetch failed');
          return basketView();
        },
        async addProductsToCart(products) {
          if (fake.failWith) throw fake.failWith;
          await new Promise((r) => setTimeout(r, 5)); // a real round trip, so requests can overlap
          const plan = fake.addPlan.shift();
          if (plan) {
            fake.added.push(products);
            for (const p of products) {
              const n = Math.min(p.quantity, plan.take?.[p.productId] ?? p.quantity);
              fake.basket.set(p.productId, (fake.basket.get(p.productId) ?? 0) + n);
            }
            if (plan.lost) throw new Error('fetch failed');
            return basketView();
          }
          const how = fake.addFails;
          fake.addFails = undefined;
          if (how === 'refused') throw new Error('500 Internal Server Error');
          fake.added.push(products);
          for (const p of products) fake.basket.set(p.productId, (fake.basket.get(p.productId) ?? 0) + p.quantity);
          if (how === 'answer-lost') throw new Error('fetch failed');
          return basketView();
        },
      },
    };
    return client;
  };
  picnic.setPicnicClientFactory(fakeFactory);
}

function addItem(menuId: number, name: string, quantity: string, group = 'groenten', checked = 0) {
  return Number(getDb().prepare(`
    INSERT INTO shopping_items (menu_id, product_group, item_name, quantity, checked) VALUES (?, ?, ?, ?, ?)
  `).run(menuId, group, name, quantity, checked).lastInsertRowid);
}

describe('Picnic', () => {
  beforeAll(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    getDb();
  });

  afterAll(() => {
    picnic.setPicnicClientFactory(null);
    closeDb();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    getDb().exec(`
      DELETE FROM picnic_account; DELETE FROM picnic_products; DELETE FROM picnic_adds;
      DELETE FROM shopping_items; DELETE FROM pantry_check; DELETE FROM menus;
    `);
    install();
  });

  describe('packSize', () => {
    it.each([
      ['500 gram', { amount: 500, measure: 'g' }],
      ['1 kilo', { amount: 1000, measure: 'g' }],
      ['1,5 kg', { amount: 1500, measure: 'g' }],
      ['3 x 125 gram', { amount: 375, measure: 'g' }],
      ['ca. 250 gram', { amount: 250, measure: 'g' }],
      ['1 liter', { amount: 1000, measure: 'ml' }],
      ['33 cl', { amount: 330, measure: 'ml' }],
      ['per stuk', { amount: 1, measure: 'stuks' }],
      ['6 stuks', { amount: 6, measure: 'stuks' }],
    ])('%s', (text, expected) => {
      expect(picnic.packSize(text)).toEqual(expected);
    });

    it('is unknown for what does not weigh or count', () => {
      expect(picnic.packSize('1 bos')).toBeNull();
      expect(picnic.packSize(null)).toBeNull();
    });
  });

  describe('packsNeeded', () => {
    it('rounds up to whole packs', () => {
      expect(picnic.packsNeeded('650 g', '500 gram', 'gehakt')).toBe(2);
      expect(picnic.packsNeeded('1.2 kg', '500 gram', 'gehakt')).toBe(3);
      expect(picnic.packsNeeded('1.5 l', '1 liter', 'melk')).toBe(2);
    });

    it('lets a little short go', () => {
      expect(picnic.packsNeeded('520 g', '500 gram', 'gehakt')).toBe(1);
    });

    it('turns pieces into grams with the typical weight', () => {
      // An onion weighs about 150 g: 6 of them is 900 g, one bag of a kilo
      expect(picnic.packsNeeded('6 stuks', '1 kilo', 'ui')).toBe(1);
      expect(picnic.packsNeeded('3 stuks', '1 kilo', 'ui')).toBe(1);
    });

    it('counts pieces against a pack of pieces', () => {
      expect(picnic.packsNeeded('8 stuks', '6 stuks', 'ei')).toBe(2);
    });

    it('is one when the two cannot be compared', () => {
      expect(picnic.packsNeeded('1 bos', '1 bos', 'peterselie')).toBe(1);
      expect(picnic.packsNeeded('naar smaak', '500 gram', 'zout')).toBe(1);
      expect(picnic.packsNeeded(null, '500 gram', 'gehakt')).toBe(1);
    });
  });

  describe('login', () => {
    it('waits for the SMS code, then keeps only the final key', async () => {
      expect(await picnic.startLogin('han@example.nl', 'geheim')).toEqual({ awaitingCode: true });
      expect(fake.calls).toEqual(['login han@example.nl', 'generate SMS pre-2fa-key']);
      expect(picnic.picnicStatus()).toEqual({ connected: false, awaitingCode: true, email: 'han@example.nl' });

      await picnic.verifyCode('123456');
      expect(fake.calls[2]).toBe('verify 123456 pre-2fa-key');
      expect(picnic.picnicStatus()).toEqual({ connected: true, awaitingCode: false, email: 'han@example.nl' });

      const row = getDb().prepare('SELECT * FROM picnic_account').get() as Record<string, unknown>;
      expect(row.auth_key).toBe('full-key');
      expect(JSON.stringify(row)).not.toContain('geheim');
    });

    it('is connected at once when Picnic asks no code', async () => {
      fake.needs2fa = false;
      expect(await picnic.startLogin('han@example.nl', 'geheim')).toEqual({ awaitingCode: false });
      expect(picnic.picnicStatus().connected).toBe(true);
    });

    it('keeps one device id across clients', async () => {
      await picnic.startLogin('han@example.nl', 'geheim');
      await picnic.verifyCode('123456');
      const ids = new Set(fake.created.map((c) => c.deviceId));
      expect(ids.size).toBe(1);
      expect([...ids][0]).toMatch(/^[0-9A-F]{16}$/);
    });

    it('refuses a code when no login waits for one', async () => {
      await expect(picnic.verifyCode('123456')).rejects.toBeInstanceOf(picnic.PicnicStateError);
    });

    it('forgets the key when Picnic no longer accepts it', async () => {
      fake.needs2fa = false;
      await picnic.startLogin('han@example.nl', 'geheim');
      fake.failWith = new Error('401 Unauthorized');
      await expect(picnic.searchProducts('ui')).rejects.toBeInstanceOf(picnic.PicnicAuthError);
      expect(picnic.picnicStatus().connected).toBe(false);
    });

    it('keeps the key on other failures', async () => {
      fake.needs2fa = false;
      await picnic.startLogin('han@example.nl', 'geheim');
      fake.failWith = new Error('fetch failed');
      await expect(picnic.searchProducts('ui')).rejects.toThrow('fetch failed');
      expect(picnic.picnicStatus().connected).toBe(true);
    });
  });

  describe('basket', () => {
    async function connect() {
      fake.needs2fa = false;
      await picnic.startLogin('han@example.nl', 'geheim');
    }

    let week = 40;
    function menu() {
      return Number(getDb().prepare("INSERT INTO menus (week_number, year, status) VALUES (?, 2026, 'active')").run(week++).lastInsertRowid);
    }

    it('proposes the top hit for open items, deduplicated, and skips cupboard amounts', async () => {
      await connect();
      const m = menu();
      addItem(m, 'gehakt', '650 g', 'vlees');
      addItem(m, 'olijfolie', '3 el', 'olie');
      addItem(m, 'courgette', '2 stuks', 'groenten', 1); // already in the basket
      fake.searchResults = {
        gehakt: [
          { id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', display_price: 499 },
          { id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', display_price: 499 },
          { id: 's2', name: 'Half-om-half', unit_quantity: '300 gram', display_price: 349 },
        ],
        olijfolie: [{ id: 's3', name: 'Olijfolie', unit_quantity: '500 ml', display_price: 699 }],
      };

      const list = await picnic.suggestForMenu(m);
      expect(list.map((s) => s.item_name)).toEqual(['olijfolie', 'gehakt']);
      const gehakt = list.find((s) => s.item_name === 'gehakt')!;
      expect(gehakt.product?.id).toBe('s1');
      expect(gehakt.alternatives.map((p) => p.id)).toEqual(['s1', 's2']);
      expect(gehakt.count).toBe(2);
      expect(gehakt.selected).toBe(true);
      expect(list.find((s) => s.item_name === 'olijfolie')!.selected).toBe(false);
    });

    it('leaves out what the pantry check says is in the house', async () => {
      await connect();
      const m = menu();
      addItem(m, 'rijst', '400 g', 'droogwaren');
      getDb().prepare('INSERT INTO pantry_check (menu_id, item_name, have_it) VALUES (?, ?, 1)').run(m, 'rijst');
      fake.searchResults = { rijst: [{ id: 's9', name: 'Rijst', unit_quantity: '1 kilo' }] };
      const [rijst] = await picnic.suggestForMenu(m);
      expect(rijst.selected).toBe(false);
    });

    const checked = (id: number) =>
      (getDb().prepare('SELECT checked FROM shopping_items WHERE id = ?').get(id) as { checked: number }).checked;
    const gehakt300 = { id: 's2', name: 'Half-om-half', unit_quantity: '300 gram', price: 349 };
    let rid = 0;
    const newId = () => `req-${String(++rid).padStart(6, '0')}`;

    it('adds to the basket, ticks off and remembers the choice', async () => {
      await connect();
      const m = menu();
      const id = addItem(m, 'gehakt', '650 g', 'vlees');

      const result = await picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3 }]);
      expect(fake.added).toEqual([[{ productId: 's2', quantity: 3 }]]);
      expect(result).toEqual({ added: 1, total_count: 3, total_price: 1234 });
      expect(checked(id)).toBe(1);
      expect(getDb().prepare('SELECT product_id FROM picnic_products').all()).toEqual([{ product_id: 's2' }]);
    });

    it('adds up items that share a product into one line', async () => {
      await connect();
      const m = menu();
      const a = addItem(m, 'cherrytomaten', '250 g');
      const b = addItem(m, 'tomaten', '500 g');
      const product = { id: 's5', name: 'Tomaten', unit_quantity: '500 gram', price: 199 };
      await picnic.addToCart(m, newId(), [{ item_id: a, product, count: 1 }, { item_id: b, product, count: 1 }]);
      expect(fake.added).toEqual([[{ productId: 's5', quantity: 2 }]]);
    });

    it('refuses items of another menu', async () => {
      await connect();
      const m = menu();
      const foreign = addItem(menu(), 'ui', '2 stuks');
      const product = { id: 's7', name: 'Uien', unit_quantity: '1 kilo', price: 129 };
      await expect(picnic.addToCart(m, newId(), [{ item_id: foreign, product, count: 1 }]))
        .rejects.toBeInstanceOf(picnic.PicnicStateError);
      expect(fake.added).toEqual([]);
    });

    describe('never twice', () => {
      const uien = { id: 's7', name: 'Uien', unit_quantity: '1 kilo', price: 129 };
      const open = () => getDb().prepare("SELECT request_id FROM picnic_adds WHERE state = 'open'").all();

      it('refuses items a second tab already put in the basket', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const lines = [{ item_id: id, product: gehakt300, count: 3 }];
        await picnic.addToCart(m, newId(), lines);
        // The other tab still shows the item as open and sends its own attempt
        await expect(picnic.addToCart(m, newId(), lines)).rejects.toThrow(/Staat al in het mandje: gehakt/);
        expect(fake.added).toHaveLength(1);
        expect(fake.basket.get('s2')).toBe(3);
      });

      it('lets only one of two attempts at the same moment through', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const lines = [{ item_id: id, product: gehakt300, count: 3 }];
        const outcomes = await Promise.allSettled([
          picnic.addToCart(m, newId(), lines),
          picnic.addToCart(m, newId(), lines),
        ]);
        expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(fake.basket.get('s2')).toBe(3);
      });

      it('refuses the same attempt while it is still talking to Picnic', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const request = newId();
        const lines = [{ item_id: id, product: gehakt300, count: 3 }];
        const outcomes = await Promise.allSettled([
          picnic.addToCart(m, request, lines),
          picnic.addToCart(m, request, lines),
        ]);
        expect(outcomes.map((o) => o.status).sort()).toEqual(['fulfilled', 'rejected']);
        expect(fake.basket.get('s2')).toBe(3);
      });

      it('answers a repeat of a finished attempt from memory', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const request = newId();
        const first = await picnic.addToCart(m, request, [{ item_id: id, product: gehakt300, count: 3 }]);
        // The answer never reached the page; it sends the same attempt again
        const again = await picnic.addToCart(m, request, [{ item_id: id, product: gehakt300, count: 3 }]);
        expect(again).toEqual(first);
        expect(fake.added).toHaveLength(1);
      });

      it('sees in the basket that an add went through although the answer got lost', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        fake.addFails = 'answer-lost';
        const result = await picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3 }]);
        expect(result.added).toBe(1);
        expect(checked(id)).toBe(1);
        expect(fake.basket.get('s2')).toBe(3);
      });

      it('counts on what was in the basket already', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        fake.basket.set('s2', 2); // put in by hand earlier in the week
        fake.addFails = 'refused';
        await expect(picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3 }]))
          .rejects.toThrow(/Niet \(helemaal\) in het mandje gekomen: Half-om-half/);
        expect(checked(id)).toBe(0);
        expect(fake.basket.get('s2')).toBe(2);
      });

      it('sends it again under the same id when the basket shows nothing went in', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const request = newId();
        fake.addFails = 'refused';
        await expect(picnic.addToCart(m, request, [{ item_id: id, product: gehakt300, count: 3 }])).rejects.toThrow();
        expect(checked(id)).toBe(0);
        expect(getDb().prepare('SELECT COUNT(*) AS n FROM picnic_products').get()).toEqual({ n: 0 });

        await picnic.addToCart(m, request, [{ item_id: id, product: gehakt300, count: 3 }]);
        expect(fake.basket.get('s2')).toBe(3);
        expect(checked(id)).toBe(1);
      });

      it('when the outcome is unknown, a retry looks in the basket before adding', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const request = newId();
        // The add lands, then the line goes down before the basket can be read
        fake.addPlan = [{ lost: true }];
        fake.cartReadPlan = [false, true];
        const lines = [{ item_id: id, product: gehakt300, count: 3 }];
        await expect(picnic.addToCart(m, request, lines)).rejects.toBeInstanceOf(picnic.PicnicUncertainError);
        expect(checked(id)).toBe(0);
        expect(fake.basket.get('s2')).toBe(3);

        // Another tab cannot add the same item meanwhile
        await expect(picnic.addToCart(m, newId(), lines)).rejects.toThrow(/nog niet afgerond/);

        // The retry finds it in the basket and does not add it again
        const result = await picnic.addToCart(m, request, lines);
        expect(result).toMatchObject({ added: 1 });
        expect(fake.added).toHaveLength(1);
        expect(fake.basket.get('s2')).toBe(3);
        expect(checked(id)).toBe(1);
      });

      // Review on 25de864, point 1
      it('keeps holding the items of an unsettled attempt, however long ago it was', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const lines = [{ item_id: id, product: gehakt300, count: 2 }];
        const first = newId();
        fake.addPlan = [{ lost: true }];
        fake.cartReadPlan = [false, true];
        await expect(picnic.addToCart(m, first, lines)).rejects.toBeInstanceOf(picnic.PicnicUncertainError);
        // An hour later the page is reloaded: a new attempt for the same item
        getDb().prepare("UPDATE picnic_adds SET updated_at = datetime('now', '-1 hour')").run();
        await expect(picnic.addToCart(m, newId(), lines)).rejects.toThrow(/nog niet afgerond/);
        expect(fake.basket.get('s2')).toBe(2);

        // The page offers to settle it instead; that looks in the basket and adds nothing
        expect(picnic.unfinishedFor(m)).toEqual([{ request_id: first, items: ['gehakt'] }]);
        await picnic.finishAttempt(m, first);
        expect(fake.basket.get('s2')).toBe(2);
        expect(checked(id)).toBe(1);
        expect(picnic.unfinishedFor(m)).toEqual([]);
      });

      // Review on 25de864, point 2
      it('keeps what earlier tries achieved through several failures in a row', async () => {
        await connect();
        const m = menu();
        const a = addItem(m, 'gehakt', '650 g', 'vlees');
        const b = addItem(m, 'ui', '4 stuks');
        const lines = [{ item_id: a, product: gehakt300, count: 3 }, { item_id: b, product: uien, count: 1 }];
        const request = newId();
        // 1st: Picnic takes the meat, not the onions; answer and basket read both lost
        fake.addPlan = [{ take: { s7: 0 }, lost: true }];
        fake.cartReadPlan = [false, true];
        await expect(picnic.addToCart(m, request, lines)).rejects.toBeInstanceOf(picnic.PicnicUncertainError);
        // 2nd: sees the meat, sends only the onions; again answer and basket read lost
        fake.addPlan = [{ lost: true }];
        fake.cartReadPlan = [false, true];
        await expect(picnic.addToCart(m, request, lines)).rejects.toBeInstanceOf(picnic.PicnicUncertainError);
        expect(fake.added[1]).toEqual([{ productId: 's7', quantity: 1 }]);
        // 3rd: everything is in; nothing goes out again
        await picnic.addToCart(m, request, lines);
        expect(fake.added).toHaveLength(2);
        expect(fake.basket.get('s2')).toBe(3);
        expect(fake.basket.get('s7')).toBe(1);
        expect([checked(a), checked(b)]).toEqual([1, 1]);
      });

      // Review on 25de864, point 3
      it('sends only the packs still missing when Picnic took part of them', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const request = newId();
        const lines = [{ item_id: id, product: gehakt300, count: 3 }];
        fake.addPlan = [{ take: { s2: 1 }, lost: true }];
        await expect(picnic.addToCart(m, request, lines)).rejects.toThrow(/Half-om-half \(1 van 3\)/);
        expect(checked(id)).toBe(0);
        expect(open()).toHaveLength(1);

        await picnic.addToCart(m, request, lines);
        expect(fake.added[1]).toEqual([{ productId: 's2', quantity: 2 }]);
        expect(fake.basket.get('s2')).toBe(3);
        expect(checked(id)).toBe(1);
      });

      it('ticks off what is complete and keeps the rest of the attempt open', async () => {
        await connect();
        const m = menu();
        const a = addItem(m, 'gehakt', '650 g', 'vlees');
        const b = addItem(m, 'ui', '4 stuks');
        // Picnic took the meat, not the onions, and then failed to answer
        fake.addPlan = [{ take: { s7: 0 }, lost: true }];
        await expect(picnic.addToCart(m, newId(), [
          { item_id: a, product: gehakt300, count: 3 },
          { item_id: b, product: uien, count: 1 },
        ])).rejects.toThrow(/Niet \(helemaal\) in het mandje gekomen: Uien\./);
        expect(checked(a)).toBe(1);
        expect(checked(b)).toBe(0);
        expect(picnic.unfinishedFor(m)).toMatchObject([{ items: ['ui'] }]);
      });

      it('gives an attempt up after a look in the basket, and says what is partly in it', async () => {
        await connect();
        const m = menu();
        const a = addItem(m, 'gehakt', '650 g', 'vlees');
        const b = addItem(m, 'ui', '4 stuks');
        const request = newId();
        fake.addPlan = [{ take: { s2: 1, s7: 1 }, lost: true }];
        await expect(picnic.addToCart(m, request, [
          { item_id: a, product: gehakt300, count: 3 },
          { item_id: b, product: uien, count: 1 },
        ])).rejects.toThrow();

        // Without Picnic the attempt cannot be given up: nobody knows what went in
        fake.cartReadsFail = true;
        await expect(picnic.abandonAttempt(m, request)).rejects.toThrow();
        expect(open()).toHaveLength(1);

        fake.cartReadsFail = false;
        expect(await picnic.abandonAttempt(m, request)).toEqual({ open: ['gehakt'], partly: 'Half-om-half (1 van 3)' });
        expect([checked(a), checked(b)]).toEqual([0, 1]);
        expect(open()).toHaveLength(0);
        expect(fake.added).toHaveLength(1);
      });

      // Review on 077f5f5: the same id with another choice must not quietly send the old one
      it('refuses the same attempt with another choice, open or finished', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        const request = newId();
        const small = { id: 's8', name: 'Gehakt klein', unit_quantity: '200 gram', price: 249 };
        fake.addFails = 'refused';
        await expect(picnic.addToCart(m, request, [{ item_id: id, product: gehakt300, count: 2 }])).rejects.toThrow();

        await expect(picnic.addToCart(m, request, [{ item_id: id, product: small, count: 4 }]))
          .rejects.toThrow(/begonnen met een andere keuze/);
        await expect(picnic.addToCart(m, request, [{ item_id: id, product: gehakt300, count: 3 }]))
          .rejects.toThrow(/begonnen met een andere keuze/);
        expect(fake.added).toEqual([]);
        expect(fake.basket.get('s8')).toBeUndefined();

        // Finishing it sends what it was started with, and says so on the list
        await picnic.finishAttempt(m, request);
        expect(fake.basket.get('s2')).toBe(2);
        await expect(picnic.addToCart(m, request, [{ item_id: id, product: small, count: 4 }]))
          .rejects.toThrow(/begonnen met een andere keuze/);
        expect(fake.basket.get('s8')).toBeUndefined();
      });

      it('lets go of a new attempt that never reached Picnic', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        fake.cartReadPlan = [true];
        await expect(picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3 }])).rejects.toThrow();
        expect(open()).toHaveLength(0);
        await picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3 }]);
        expect(fake.basket.get('s2')).toBe(3);
      });
    });

    describe('fresh product data', () => {
      it('shows a remembered product as Picnic has it today, and counts with its new pack', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        await picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3, picked: true }]);

        // Next week the pack went down to 250 gram and the price up
        const next = menu();
        addItem(next, 'Gehakt', '600 g', 'vlees');
        fake.searchResults = { Gehakt: [
          { id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', display_price: 499 },
          { id: 's2', name: 'Half-om-half', unit_quantity: '250 gram', display_price: 379 },
        ] };
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product).toMatchObject({ id: 's2', name: 'Half-om-half', unit_quantity: '250 gram', price: 379 });
        expect(s.remembered).toBe(true);
        expect(s.count).toBe(3);
        expect(getDb().prepare('SELECT unit_quantity, price FROM picnic_products').get())
          .toEqual({ unit_quantity: '250 gram', price: 379 });
      });

      it('looks a remembered product up by id when the search does not show it', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        await picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3, picked: true }]);
        const next = menu();
        addItem(next, 'gehakt', '650 g', 'vlees');
        fake.searchResults = { gehakt: [{ id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', display_price: 499 }] };
        fake.details = { s2: { name: 'Half-om-half', brand: 'Picnic', unitQuantity: '300 gram', displayPrice: 359 } };
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product).toMatchObject({ id: 's2', name: 'Picnic Half-om-half', unit_quantity: '300 gram', price: 359 });
        expect(s.remembered).toBe(true);
      });

      it('says so when a remembered product is gone, and proposes the top hit', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        await picnic.addToCart(m, newId(), [{ item_id: id, product: gehakt300, count: 3, picked: true }]);
        const next = menu();
        addItem(next, 'gehakt', '650 g', 'vlees');
        fake.searchResults = { gehakt: [{ id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', display_price: 499 }] };
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product?.id).toBe('s1');
        expect(s.remembered).toBe(false);
        expect(s.previous).toBe('Half-om-half');
        expect(s.count).toBe(2);
      });
    });

    describe('preferences', () => {
      const frozenTag = [{ type: 'PRODUCT_CHARACTERISTICS', characteristics: [{ type: 'FROZEN' }] }];

      it('proposes fresh over frozen, and the house brand, with frozen hits last', async () => {
        await connect();
        const m = menu();
        addItem(m, 'spinazie', '600 g');
        fake.searchResults = { spinazie: [
          { id: 'f1', name: 'Iglo bladspinazie', unit_quantity: '450 gram', display_price: 249 },
          { id: 'f2', name: 'Spinazie à la crème', unit_quantity: '450 gram', display_price: 199, decorators: frozenTag },
          { id: 'v1', name: 'Bonduelle verse spinazie', unit_quantity: '300 gram', display_price: 229 },
          { id: 'v2', name: 'Picnic spinazie', unit_quantity: '300 gram', display_price: 189 },
        ] };
        const [s] = await picnic.suggestForMenu(m);
        expect(s.product).toMatchObject({ id: 'v2', frozen: false, house_brand: true });
        expect(s.count).toBe(2);
        expect(s.selected).toBe(true);
        expect(s.alternatives.map((a) => a.id)).toEqual(['v2', 'v1', 'f1', 'f2']);
        expect(s.alternatives.slice(2).every((a) => a.frozen)).toBe(true);
      });

      it('asks Picnic for fresh by name when it shows only frozen', async () => {
        await connect();
        const m = menu();
        addItem(m, 'spinazie', '600 g');
        fake.searchResults = {
          spinazie: [{ id: 'f1', name: 'Iglo bladspinazie', unit_quantity: '450 gram' }],
          'spinazie vers': [{ id: 'v2', name: 'Picnic spinazie', unit_quantity: '300 gram' }],
        };
        const [s] = await picnic.suggestForMenu(m);
        expect(s.product?.id).toBe('v2');
        expect(fake.calls.filter((c) => c.startsWith('search'))).toHaveLength(2);
      });

      it('leaves a frozen-only proposal for fresh off, saying so', async () => {
        await connect();
        const m = menu();
        addItem(m, 'zalmfilet', '500 g', 'vis');
        fake.searchResults = { zalmfilet: [{ id: 'f9', name: 'Picnic zalmfilet diepvries', unit_quantity: '250 gram' }] };
        const [s] = await picnic.suggestForMenu(m);
        expect(s.product?.id).toBe('f9');
        expect(s.selected).toBe(false);
        expect(s.note).toMatch(/alleen diepvries/);
      });

      it('takes frozen when the recipe asks for it', async () => {
        await connect();
        const m = menu();
        addItem(m, 'diepvries spinazie', '450 g');
        fake.searchResults = { 'diepvries spinazie': [
          { id: 'v2', name: 'Picnic spinazie', unit_quantity: '300 gram' },
          { id: 'f1', name: 'Iglo bladspinazie', unit_quantity: '450 gram' },
        ] };
        const [s] = await picnic.suggestForMenu(m);
        expect(s.product?.id).toBe('f1');
        expect(s.selected).toBe(true);
      });

      it('does not keep proposing a frozen product chosen before for a fresh item', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'spinazie', '600 g');
        const frozen = { id: 'f1', name: 'Iglo bladspinazie', unit_quantity: '450 gram', price: 249 };
        await picnic.addToCart(m, 'req-pref-0001', [{ item_id: id, product: frozen, count: 2, picked: true }]);
        const next = menu();
        addItem(next, 'spinazie', '600 g');
        fake.searchResults = { spinazie: [
          { id: 'f1', name: 'Iglo bladspinazie', unit_quantity: '450 gram', display_price: 249 },
          { id: 'v2', name: 'Picnic spinazie', unit_quantity: '300 gram', display_price: 189 },
        ] };
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product?.id).toBe('v2');
        expect(s.remembered).toBe(false);
        expect(s.note).toBe('vorige keer Iglo bladspinazie, maar dat is diepvries');
      });

      it('leaves cheese for the cheese shop and the cupboard off, with the reason', async () => {
        await connect();
        const m = menu();
        addItem(m, 'geraspte kaas', '100 g', 'zuivel');
        addItem(m, 'sojasaus', '50 ml', 'sauzen');
        addItem(m, 'mozzarella', '125 g', 'zuivel');
        fake.searchResults = {
          'geraspte kaas': [{ id: 'k1', name: 'Picnic geraspte kaas', unit_quantity: '150 gram' }],
          sojasaus: [{ id: 'k2', name: 'Picnic sojasaus', unit_quantity: '250 ml' }],
          mozzarella: [{ id: 'k3', name: 'Picnic mozzarella', unit_quantity: '125 gram' }],
        };
        const list = await picnic.suggestForMenu(m);
        const by = (n: string) => list.find((x) => x.item_name === n)!;
        expect([by('geraspte kaas').selected, by('geraspte kaas').note]).toEqual([false, 'kaas komt van de kaasboer']);
        expect([by('sojasaus').selected, by('sojasaus').note]).toEqual([false, 'voorraadkast']);
        expect([by('mozzarella').selected, by('mozzarella').note]).toEqual([true, null]);
      });

      it('ranks a search for another product by the same preferences', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'penne', '500 g', 'droogwaren');
        fake.searchResults = { pasta: [
          { id: 'p1', name: 'Barilla penne', unit_quantity: '500 gram' },
          { id: 'p2', name: 'Picnic penne', unit_quantity: '500 gram' },
          { id: 'p3', name: 'Picnic volkoren penne', unit_quantity: '500 gram' },
        ] };
        expect((await picnic.searchForItem(id, 'pasta')).map((h) => h.id)).toEqual(['p3', 'p2', 'p1']);
      });
    });

    describe('house brand over brands known for tins', () => {
      // Han's example: Bonduelle came first for "kikkererwten uit blik" because the brand counted as a tin
      it('puts the Picnic tin first, and seasoned or dried pulses last', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'kikkererwten uit blik', '1 blik', 'droogwaren');
        fake.searchResults = { 'kikkererwten uit blik': [
          { id: 'b1', name: 'Bonduelle zwarte kikkererwten', unit_quantity: '150 gram', display_price: 149 },
          { id: 'b2', name: 'Bonduelle kikkererwten in mediterraanse saus', unit_quantity: '400 gram', display_price: 289 },
          { id: 'b3', name: 'Bonduelle kikkererwten', unit_quantity: '310 gram', display_price: 199 },
          { id: 'p1', name: 'Picnic kikkererwten', unit_quantity: '400 gram', display_price: 99 },
          { id: 'p2', name: 'Picnic kikkererwten', unit_quantity: '3 x 200 gram', display_price: 199 },
          { id: 'a1', name: 'Amaizin kikkererwten', unit_quantity: '400 gram', display_price: 249 },
        ] };
        const [s] = await picnic.suggestForMenu(m);
        expect(s.product?.id).toBe('p1');
        expect(s.count).toBe(1);
        expect(s.alternatives.map((a) => a.id)).toEqual(['p1', 'p2', 'b1', 'b3', 'a1', 'b2']);
        expect((await picnic.searchForItem(id, 'kikkererwten uit blik'))[0].id).toBe('p1');
      });

      it('takes tinned lentils over dried red ones', async () => {
        await connect();
        const m = menu();
        addItem(m, 'rode linzen', '250 g', 'droogwaren');
        fake.searchResults = { 'rode linzen': [
          { id: 'l1', name: 'Picnic rode linzen', unit_quantity: '400 gram' },
          { id: 'l2', name: 'Picnic linzen', unit_quantity: '400 gram' },
        ] };
        const [s] = await picnic.suggestForMenu(m);
        expect(s.product?.id).toBe('l2');
      });
    });

    describe('what is remembered', () => {
      const bonduelle = { id: 'b3', name: 'Bonduelle kikkererwten', unit_quantity: '310 gram', price: 199 };
      const hits = { kikkererwten: [
        { id: 'b3', name: 'Bonduelle kikkererwten', unit_quantity: '310 gram', display_price: 199 },
        { id: 'p1', name: 'Picnic kikkererwten', unit_quantity: '400 gram', display_price: 99 },
      ] };

      it('weighs a proposal that was only accepted again, so a better fit takes over', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'kikkererwten', '400 g', 'droogwaren');
        await picnic.addToCart(m, 'req-mem-0001', [{ item_id: id, product: bonduelle, count: 2 }]);
        const next = menu();
        addItem(next, 'kikkererwten', '400 g', 'droogwaren');
        fake.searchResults = hits;
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product?.id).toBe('p1');
        expect([s.remembered, s.picked]).toEqual([false, false]);
      });

      it('keeps a product picked by hand, whatever ranks first', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'kikkererwten', '400 g', 'droogwaren');
        await picnic.addToCart(m, 'req-mem-0002', [{ item_id: id, product: bonduelle, count: 2, picked: true }]);
        const next = menu();
        addItem(next, 'kikkererwten', '400 g', 'droogwaren');
        fake.searchResults = hits;
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product?.id).toBe('b3');
        expect([s.remembered, s.picked]).toEqual([true, true]);
      });

      it('shows an accepted proposal as last time when it still fits best', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'kikkererwten', '400 g', 'droogwaren');
        const picnicTin = { id: 'p1', name: 'Picnic kikkererwten', unit_quantity: '400 gram', price: 99 };
        await picnic.addToCart(m, 'req-mem-0003', [{ item_id: id, product: picnicTin, count: 1 }]);
        const next = menu();
        addItem(next, 'kikkererwten', '400 g', 'droogwaren');
        fake.searchResults = hits;
        const [s] = await picnic.suggestForMenu(next);
        expect(s.product?.id).toBe('p1');
        expect([s.remembered, s.picked]).toEqual([true, false]);
      });
    });

    describe('another pack', () => {
      it('gives each search hit its own pack count for the item', async () => {
        await connect();
        const m = menu();
        const id = addItem(m, 'gehakt', '650 g', 'vlees');
        fake.searchResults = { 'gehakt 200': [
          { id: 's8', name: 'Gehakt klein', unit_quantity: '200 gram', display_price: 249 },
          { id: 's9', name: 'Gehakt groot', unit_quantity: '1 kilo', display_price: 899 },
        ] };
        const hits = await picnic.searchForItem(id, 'gehakt 200');
        expect(hits.map((h) => [h.id, h.count])).toEqual([['s8', 4], ['s9', 1]]);
      });

      it('proposes alternatives with their own counts', async () => {
        await connect();
        const m = menu();
        addItem(m, 'gehakt', '650 g', 'vlees');
        fake.searchResults = { gehakt: [
          { id: 's1', name: 'Rundergehakt', unit_quantity: '500 gram', display_price: 499 },
          { id: 's8', name: 'Gehakt klein', unit_quantity: '200 gram', display_price: 249 },
        ] };
        const [s] = await picnic.suggestForMenu(m);
        // Best fit first: 4 × 200 g leaves less over for 650 g than 2 × 500 g
        expect(s.alternatives.map((h) => [h.id, h.count])).toEqual([['s8', 4], ['s1', 2]]);
      });
    });

    it('needs a connected account', async () => {
      const m = menu();
      addItem(m, 'ui', '2 stuks');
      await expect(picnic.suggestForMenu(m)).rejects.toBeInstanceOf(picnic.PicnicStateError);
    });
  });
});
