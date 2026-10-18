import { describe, it, expect } from 'vitest';
import { frozenMismatch, itemWish, productFacts, rank } from '../server/services/picnic-preferences';

const october = new Date('2026-10-18');
const july = new Date('2026-07-01');

describe('productFacts', () => {
  it('reads frozen from Picnic decorators', () => {
    expect(productFacts({ name: 'Spinazie', decorators: [{ type: 'FROZEN' }] }).frozen).toBe(true);
    expect(productFacts({
      name: 'Spinazie',
      decorators: [{ type: 'PRODUCT_CHARACTERISTICS', characteristics: [{ type: 'FROZEN', rating: null }] }],
    }).frozen).toBe(true);
  });

  it('reads frozen from the name and from frozen-only brands', () => {
    expect(productFacts({ name: 'Picnic spinazie diepvries' }).frozen).toBe(true);
    expect(productFacts({ name: 'Iglo bladspinazie' }).frozen).toBe(true);
    expect(productFacts({ name: 'Picnic verse spinazie' }).frozen).toBe(false);
    expect(productFacts({ name: 'Picnic ijsbergsla' }).frozen).toBe(false);
  });

  it('knows the house brand and organic', () => {
    expect(productFacts({ name: 'Picnic halfvolle melk' })).toMatchObject({ houseBrand: true, organic: false });
    expect(productFacts({ name: 'Picnic bio halfvolle melk' })).toMatchObject({ houseBrand: true, organic: true });
    expect(productFacts({ name: 'Campina halfvolle melk' }).houseBrand).toBe(false);
  });
});

describe('itemWish', () => {
  it('wants fresh unless the recipe says frozen', () => {
    expect(itemWish('spinazie', 'groenten', '600 g').frozen).toBe(false);
    expect(itemWish('zalmfilet', 'vis', '500 g').frozen).toBe(false);
    expect(itemWish('diepvries spinazie', 'groenten', '450 g').frozen).toBe(true);
    expect(itemWish('bladspinazie', 'diepvries', '450 g').frozen).toBe(true);
  });

  it('takes either for what is usually bought frozen', () => {
    expect(itemWish('doperwten', 'groenten', '300 g').frozen).toBeNull();
    expect(itemWish('sperziebonen', 'groenten', '400 g').frozen).toBeNull();
  });

  it('wants organic where it matters, paprika and leafy greens only in winter', () => {
    expect(itemWish('halfvolle melk', 'zuivel', '1 l').organic).toBe(true);
    expect(itemWish('eieren', 'zuivel', '6 stuks').organic).toBe(true);
    expect(itemWish('rundergehakt', 'vlees', '500 g').organic).toBe(true);
    expect(itemWish('ui', 'groenten', '2 stuks').organic).toBe(false);
    expect(itemWish('eikenbladsla', 'groenten', '1 krop', july).organic).toBe(false);
    expect(itemWish('rode paprika', 'groenten', '2 stuks', october).organic).toBe(true);
    expect(itemWish('rode paprika', 'groenten', '2 stuks', july).organic).toBe(false);
  });

  it('leaves bread, cheese, herring and the cupboard to elsewhere', () => {
    expect(itemWish('volkoren brood', 'brood', '1 stuks').elsewhere).toMatch(/bakker/);
    expect(itemWish('geraspte kaas', 'zuivel', '100 g').elsewhere).toMatch(/kaasboer/);
    expect(itemWish('belegen kaas', 'zuivel', '200 g').elsewhere).toMatch(/kaasboer/);
    expect(itemWish('mozzarella', 'zuivel', '125 g').elsewhere).toBeNull();
    expect(itemWish('parmezaanse kaas', 'zuivel', '50 g').elsewhere).toBeNull();
    expect(itemWish('haring', 'vis', '4 stuks').elsewhere).toMatch(/visboer/);
    expect(itemWish('olijfolie', 'olie', '100 ml').elsewhere).toBe('voorraadkast');
    expect(itemWish('sojasaus', 'sauzen', '50 ml').elsewhere).toBe('voorraadkast');
    expect(itemWish('gedroogde oregano', 'kruiden', '1 tl').elsewhere).toBe('voorraadkast');
    expect(itemWish('komijn', 'kruiden', '2 tl').elsewhere).toBe('voorraadkast');
    expect(itemWish('koriander', 'kruiden', '1 bos').elsewhere).toBeNull();
    expect(itemWish('peperoni', 'vlees', '100 g').elsewhere).toBeNull();
    expect(itemWish('broodkruim', 'droogwaren', '50 g').elsewhere).toBeNull();
  });
});

describe('rank', () => {
  const candidate = (name: string, waste: number | null = null, frozen = false) =>
    ({ product: { name }, facts: { ...productFacts({ name }), frozen: frozen || productFacts({ name }).frozen }, waste });
  const best = (item: string, group: string, names: Array<ReturnType<typeof candidate>>, date = october) =>
    rank(itemWish(item, group, null, date), names).map((c) => c.product.name);

  it('puts fresh first when fresh is wanted, frozen first when frozen is', () => {
    const list = [candidate('Iglo spinazie à la crème'), candidate('Picnic spinazie diepvries'), candidate('Verse spinazie')];
    expect(best('spinazie', 'groenten', list)[0]).toBe('Verse spinazie');
    expect(best('diepvries spinazie', 'groenten', list).slice(-1)).toEqual(['Verse spinazie']);
  });

  it('prefers the house brand', () => {
    expect(best('passata', 'droogwaren', [candidate('Mutti passata'), candidate('Picnic passata')])[0]).toBe('Picnic passata');
  });

  it('prefers whole grain over the house brand, and the house brand within whole grain', () => {
    expect(best('penne', 'droogwaren', [
      candidate('Picnic penne'), candidate('Barilla volkoren penne'), candidate('Picnic volkoren penne'),
    ])).toEqual(['Picnic volkoren penne', 'Barilla volkoren penne', 'Picnic penne']);
  });

  it('takes lentils from a tin, also when the recipe says dried red ones', () => {
    expect(best('rode linzen', 'droogwaren', [candidate('Picnic rode linzen'), candidate('Hak linzen')])[0]).toBe('Hak linzen');
  });

  it('takes organic milk and eggs, peeled potatoes and ready-cut chicken', () => {
    expect(best('halfvolle melk', 'zuivel', [candidate('Picnic halfvolle melk'), candidate('Picnic bio halfvolle melk')])[0])
      .toBe('Picnic bio halfvolle melk');
    expect(best('aardappelen', 'groenten', [candidate('Picnic kruimige aardappelen'), candidate('Picnic geschilde aardappelen')])[0])
      .toBe('Picnic geschilde aardappelen');
    expect(best('kipfilet', 'vlees', [candidate('Picnic kipfilet'), candidate('Picnic kipfiletreepjes')])[0])
      .toBe('Picnic kipfiletreepjes');
  });

  it('breaks a tie on the pack that leaves least over', () => {
    expect(best('courgette', 'groenten', [candidate('Picnic courgettes 3 stuks', 0.5), candidate('Picnic courgette', 0)])[0])
      .toBe('Picnic courgette');
  });

  it('tells a frozen product apart from what is wanted', () => {
    const wish = itemWish('zalmfilet', 'vis', '500 g');
    expect(frozenMismatch(wish, productFacts({ name: 'Picnic zalmfilet diepvries' }))).toBe(true);
    expect(frozenMismatch(itemWish('doperwten', 'groenten', null), productFacts({ name: 'Iglo doperwten' }))).toBe(false);
  });
});
