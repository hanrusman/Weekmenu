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
  failWith?: Error;
  created: Array<{ authKey?: string; deviceId: string }>;
}

let fake: Fake;

function install() {
  fake = { calls: [], added: [], needs2fa: true, searchResults: {}, created: [] };
  picnic.setPicnicClientFactory((options) => {
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
      },
      cart: {
        async addProductsToCart(products) {
          if (fake.failWith) throw fake.failWith;
          fake.added.push(products);
          return { total_count: products.reduce((s, p) => s + p.quantity, 0), total_price: 1234 };
        },
      },
    };
    return client;
  });
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
      DELETE FROM picnic_account; DELETE FROM picnic_products;
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

    it('adds to the basket, ticks off and remembers the choice for next week', async () => {
      await connect();
      const m = menu();
      const id = addItem(m, 'gehakt', '650 g', 'vlees');
      const product = { id: 's2', name: 'Half-om-half', unit_quantity: '300 gram', price: 349 };

      const result = await picnic.addToCart(m, [{ item_id: id, product, count: 3 }]);
      expect(fake.added).toEqual([[{ productId: 's2', quantity: 3 }]]);
      expect(result).toEqual({ added: 1, total_count: 3, total_price: 1234 });
      expect((getDb().prepare('SELECT checked FROM shopping_items WHERE id = ?').get(id) as { checked: number }).checked).toBe(1);

      // Next week: the same item proposes the same product without searching
      const next = menu();
      addItem(next, 'Gehakt', '600 g', 'vlees');
      fake.calls = [];
      const [s] = await picnic.suggestForMenu(next);
      expect(s.product).toEqual(product);
      expect(s.remembered).toBe(true);
      expect(s.count).toBe(2);
      expect(fake.calls.filter((c) => c.startsWith('search'))).toEqual([]);
    });

    it('adds up items that share a product into one line', async () => {
      await connect();
      const m = menu();
      const a = addItem(m, 'cherrytomaten', '250 g');
      const b = addItem(m, 'tomaten', '500 g');
      const product = { id: 's5', name: 'Tomaten', unit_quantity: '500 gram', price: 199 };
      await picnic.addToCart(m, [{ item_id: a, product, count: 1 }, { item_id: b, product, count: 1 }]);
      expect(fake.added).toEqual([[{ productId: 's5', quantity: 2 }]]);
    });

    it('refuses items of another menu and ticks nothing off when Picnic fails', async () => {
      await connect();
      const m = menu();
      const other = menu();
      const foreign = addItem(other, 'ui', '2 stuks');
      const product = { id: 's7', name: 'Uien', unit_quantity: '1 kilo', price: 129 };
      await expect(picnic.addToCart(m, [{ item_id: foreign, product, count: 1 }]))
        .rejects.toBeInstanceOf(picnic.PicnicStateError);

      const own = addItem(m, 'ui', '2 stuks');
      fake.failWith = new Error('fetch failed');
      await expect(picnic.addToCart(m, [{ item_id: own, product, count: 1 }])).rejects.toThrow();
      expect((getDb().prepare('SELECT checked FROM shopping_items WHERE id = ?').get(own) as { checked: number }).checked).toBe(0);
      expect(getDb().prepare('SELECT COUNT(*) AS n FROM picnic_products').get()).toEqual({ n: 0 });
    });

    it('needs a connected account', async () => {
      const m = menu();
      addItem(m, 'ui', '2 stuks');
      await expect(picnic.suggestForMenu(m)).rejects.toBeInstanceOf(picnic.PicnicStateError);
    });
  });
});
