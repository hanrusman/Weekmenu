import { describe, it, expect } from 'vitest';
import { frozenMismatch, hasQualifier, headOf, isRelevant, itemWish, productFacts, rank } from '../server/services/picnic-preferences';

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
    // Only at the start of a word: chickpeas are not peas
    expect(itemWish('kikkererwten', 'droogwaren', '400 g').frozen).toBe(false);
  });

  // Review (GLM): 'diepgevroren' in a recipe was read as fresh
  it('reads every way a recipe says frozen', () => {
    expect(itemWish('diepgevroren spinazie', 'groenten', '450 g').frozen).toBe(true);
    expect(itemWish('diepvriesspinazie', 'groenten', '450 g').frozen).toBe(true);
    expect(itemWish('vriesverse boontjes', 'groenten', '300 g').frozen).toBe(true);
    expect(productFacts({ name: 'Picnic vriesverse spinazie' }).frozen).toBe(true);
    expect(productFacts({ name: 'Picnic diepvriesspinazie' }).frozen).toBe(true);
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

describe('review findings', () => {
  // Mistral: 'Picnic' not first in the name, or with a trademark sign
  it('knows the house brand wherever the name says Picnic', () => {
    expect(productFacts({ name: 'Picnic® volkoren penne' }).houseBrand).toBe(true);
    expect(productFacts({ name: 'Appelmoes Picnic' }).houseBrand).toBe(true);
    expect(productFacts({ name: 'Picknicktafel kaasjes' }).houseBrand).toBe(false);
  });

  // Mistral: 'ongeschilde' contains 'geschild'
  it('does not take unpeeled potatoes for peeled ones', () => {
    const wish = itemWish('aardappelen', 'groenten', '1 kg');
    expect(wish.prefer.some((p) => p.test('picnic ongeschilde aardappelen'))).toBe(false);
    expect(wish.prefer.some((p) => p.test('picnic geschilde aardappelen'))).toBe(true);
  });

  // Mistral: a small tin
  it('takes a small tin for a tin', () => {
    expect(itemWish('kikkererwten', 'droogwaren', '200 g').prefer.some((p) => p.test('kikkererwten blikje'))).toBe(true);
  });

  // Found in review: fresh chili ends in 'peper', seasoned salt and cayenne do not start with it
  it('buys fresh chili but leaves salt and pepper blends in the cupboard', () => {
    expect(itemWish('rode peper', 'groenten', '1 stuks').elsewhere).toBeNull();
    expect(itemWish('spaanse pepers', 'groenten', '2 stuks').elsewhere).toBeNull();
    expect(itemWish('zwarte peper', 'kruiden', 'snufje').elsewhere).toBe('voorraadkast');
    expect(itemWish('cayennepeper', 'kruiden', '1 tl').elsewhere).toBe('voorraadkast');
    expect(itemWish('knoflookzout', 'kruiden', '1 tl').elsewhere).toBe('voorraadkast');
    expect(itemWish('ongezouten roomboter', 'zuivel', '50 g').elsewhere).toBe('voorraadkast');
    expect(itemWish('ongezouten pinda', 'droogwaren', '100 g').elsewhere).toBeNull();
  });
});

describe('review findings PR #30', () => {
  // GLM: an avoided word that the recipe itself asks for punished the very product asked for
  it('does not avoid what the recipe asks for', () => {
    const wish = itemWish('bruine bonen in tomatensaus', 'droogwaren', '1 blik');
    expect(wish.avoid.some((p) => p.test('hak bruine bonen in tomatensaus'))).toBe(false);
    expect(itemWish('bruine bonen', 'droogwaren', '1 blik').avoid.some((p) => p.test('hak bruine bonen in tomatensaus'))).toBe(true);
  });

  it('keeps lentils from a tin even when the recipe says red', () => {
    expect(itemWish('rode linzen', 'droogwaren', '250 g').avoid.some((p) => p.test('picnic rode linzen'))).toBe(true);
  });

  // GLM: 'ongekruid' contains 'gekruid'
  it('does not take unseasoned for seasoned', () => {
    const wish = itemWish('kikkererwten', 'droogwaren', '400 g');
    expect(wish.avoid.some((p) => p.test('picnic ongekruide kikkererwten'))).toBe(false);
    expect(wish.avoid.some((p) => p.test('picnic gekruide kikkererwten'))).toBe(true);
  });
});

describe('the item itself', () => {
  it('finds the main word and what qualifies it', () => {
    expect(headOf('griekse yoghurt')).toEqual({ head: 'yoghurt', qualifiers: ['griekse'], options: [] });
    expect(headOf('kikkererwten uit blik')).toEqual({ head: 'kikkererwten', qualifiers: [], options: [] });
    expect(headOf('bruine bonen in tomatensaus')).toEqual({ head: 'bonen', qualifiers: ['bruine'], options: [] });
    expect(headOf('verse spinazie')).toEqual({ head: 'spinazie', qualifiers: [], options: [] });
  });

  it('knows the item from things made from it', () => {
    const is = (item: string, product: string) => isRelevant(headOf(item), product);
    expect(is('ui', 'Picnic uien')).toBe(true);
    expect(is('ui', 'Picnic rode uien')).toBe(true);
    expect(is('ui', 'Picnic uienringen')).toBe(false);
    expect(is('komkommer', 'Komkommer')).toBe(true);
    expect(is('komkommer', 'Picnic komkommersalade')).toBe(false);
    expect(is('verse spinazie', 'Bio babyspinazie')).toBe(true);
    expect(is('ei', 'Picnic vrije uitloop eieren')).toBe(true);
    expect(is('avocado', "Picnic avocado's")).toBe(true);
    expect(is('kipfilet', 'Picnic kipfiletreepjes')).toBe(true);
    expect(is('knoflook', 'Picnic knoflookbollen')).toBe(true);
    expect(is('knoflook', 'Picnic knoflookteentjes')).toBe(true);
    expect(is('munt', 'Picnic muntthee')).toBe(false);
    expect(is('aardbeien', 'Picnic yoghurt aardbei')).toBe(false);
    expect(is('olijfolie', 'Picnic olijfolie extra vierge')).toBe(true);
    expect(is('griekse yoghurt', 'Picnic yoghurt Griekse stijl')).toBe(true);
    expect(is('rode linzen', 'Picnic verspakket rode linzensoep')).toBe(false);
    expect(is('tempeh', 'Picnic tofu')).toBe(false);
  });

  // Own review of #31: Dutch plurals and diminutives change the vowel
  it('sees plurals and diminutives with another vowel', () => {
    const is = (item: string, product: string) => isRelevant(headOf(item), product);
    expect(is('cherrytomaten', 'Picnic cherrytomaatjes')).toBe(true);
    expect(is('tomaten', 'Bio trostomaten')).toBe(true);
    expect(is('sperziebonen', 'Picnic sperzieboontjes')).toBe(true);
    expect(is('blauwe bessen', 'Picnic blauwe bessen')).toBe(true);
    expect(is('peren', 'Conference peer')).toBe(true);
    expect(is('melk', 'Picnic melkchocolade')).toBe(false);
    expect(is('rijst', 'Picnic rijstwafels')).toBe(false);
    expect(is('tomaten', 'Picnic tomatensoep')).toBe(false);
    expect(is('kaas', 'Picnic paprika')).toBe(false);
    expect(is('kaas', 'Picnic geitenkaas')).toBe(true);
    expect(is('ui', 'Picnic uien')).toBe(true);
  });

  it('does not ask a frozen product to say so in its name', () => {
    expect(headOf('diepvries spinazie').qualifiers).toEqual([]);
  });

  it('matches qualifiers in any inflection', () => {
    expect(hasQualifier('Paprika rood', 'rode')).toBe(true);
    expect(hasQualifier('Picnic witte kool', 'witte')).toBe(true);
    expect(hasQualifier('Kool wit', 'witte')).toBe(true);
    expect(hasQualifier('Campina Griekse stijl yoghurt', 'griekse')).toBe(true);
    expect(hasQualifier('Picnic yoghurt naturel', 'griekse')).toBe(false);
    // The brand Pur Natur is not natural yoghurt
    expect(hasQualifier('Pur Natur bio yoghurt abrikoos', 'natuurlijke')).toBe(false);
    expect(hasQualifier('Almhof roeryoghurt naturel', 'natuurlijke')).toBe(true);
    expect(hasQualifier('Picnic bio halfvolle melk', 'halfvolle')).toBe(true);
    expect(hasQualifier('Picnic volle melk', 'halfvolle')).toBe(false);
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
