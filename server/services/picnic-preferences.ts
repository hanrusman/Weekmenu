/**
 * Han's shopping preferences (from the AH shopping notes), applied to Picnic:
 * fresh unless the recipe asks for frozen, the house brand by default, and
 * whole grain, tinned pulses, peeled potatoes, pre-cut chicken and organic
 * where it matters. Some things are not bought at the supermarket at all.
 */

/** Words that say frozen, in a product name or a recipe ingredient. */
const FROZEN_WORDS = /\b(diepvries\w*|diepgevroren|bevroren|frozen|vriesvers\w*)\b/;

export interface ProductFacts {
  frozen: boolean;
  organic: boolean;
  houseBrand: boolean;
}

/** What Picnic says about a product: its decorators where present, else its name. */
export function productFacts(p: { name: string; decorators?: unknown[] }): ProductFacts {
  const decorators = (p.decorators ?? []) as Array<{ type?: string; characteristics?: Array<{ type?: string }> }>;
  const frozenByDecorator = decorators.some((d) => d?.type === 'FROZEN'
    || (d?.type === 'PRODUCT_CHARACTERISTICS' && (d.characteristics ?? []).some((c) => c?.type === 'FROZEN')));
  const name = p.name.toLowerCase().replace(/[®™]/g, '');
  return {
    frozen: frozenByDecorator || FROZEN_WORDS.test(name)
      || /^(iglo|findus|ardo)\b/.test(name),
    organic: /\b(bio|biologisch|biologische|organic)\b/.test(name),
    houseBrand: /\bpicnic\b/.test(name),
  };
}

export interface ItemWish {
  /** true: frozen wanted; false: fresh wanted; null: either is fine. */
  frozen: boolean | null;
  organic: boolean;
  /** Name patterns that make a product a better fit (volkoren, blik, geschild, reepjes). */
  prefer: RegExp[];
  /** Name patterns that make it a worse fit (dried or seasoned pulses). */
  avoid: RegExp[];
  /** Why the item stays off by default (bakker, kaasboer, voorraadkast), or null. */
  elsewhere: string | null;
}

const has = (name: string, ...words: string[]) => words.some((w) => new RegExp(`\\b${w}`).test(name));

// Frozen is the usual choice for these even when the recipe does not say so
const FROZEN_OK = ['doperwt', 'erwten', 'sperzieboon', 'sperziebonen', 'edamame', 'tuinbonen', 'vissticks', 'lekkerbek', 'kibbeling'];
// Fresh chili is bought, though its name ends in 'peper'
const FRESH_CHILI = /\b(spaanse|rode|groene|verse)\s+pepers?\b|\bchilipeper|\bjalape/;
// Fresh herbs are bought; dried ones are in the cupboard
const FRESH_HERBS = ['koriander', 'peterselie', 'basilicum', 'bieslook', 'munt', 'dille', 'dragon', 'kervel', 'citroengras', 'bosui'];
const CUPBOARD = ['olie', 'olijfolie', 'zonnebloemolie', 'sojasaus', 'ketjap', 'bouillon', 'mosterd', 'roomboter', 'boter\\b',
  '\\w*zout\\b', '\\w*peper\\b', 'azijn', 'balsamico', 'kerrie', 'komijn', 'paprikapoeder', 'kaneel', 'nootmuskaat',
  'chilivlokken', 'oregano', 'gedroogde', 'specerij', 'kruidenmix'];

/** Months in which paprika, snack tomatoes and leafy greens are better organic (Oct–Apr). */
const isWinter = (date: Date) => date.getMonth() >= 9 || date.getMonth() <= 3;

export function itemWish(itemName: string, productGroup: string, quantity: string | null, date = new Date()): ItemWish {
  const name = itemName.trim().toLowerCase();
  const prefer: RegExp[] = [];
  const avoid: RegExp[] = [];

  let frozen: boolean | null = false;
  if (FROZEN_WORDS.test(name) || productGroup === 'diepvries') frozen = true;
  else if (has(name, ...FROZEN_OK)) frozen = null;

  // Whole grain where it exists
  if (has(name, 'pasta', 'spaghetti', 'penne', 'fusilli', 'macaroni', 'tagliatelle', 'rijst', 'wrap', 'couscous',
    'pita', 'noedel', 'mie', 'bollen', 'tortilla')) {
    prefer.push(/volkoren|zilvervlies|meergranen/);
  }
  // Pulses from a tin or jar, also when the recipe says dried (lentils always). Only words
  // count, not brands: a brand known for tins must not beat the house brand's tin
  if (has(name, 'linzen', 'kikkererwt', 'kidneybon', 'zwarte bonen', 'witte bonen', 'bruine bonen', 'cannellini', 'borlotti')) {
    prefer.push(/\bblik(je)?\b|gekookt|\bpot\b|\bglas\b/);
    avoid.push(/gedroogd|\bdroge?\b|saus|gekruid|curry|chili/);
    // Red and yellow lentils are sold dried
    if (has(name, 'linzen')) avoid.push(/\b(rode|gele) linzen\b/);
  }
  // Potatoes peeled (stamppot potatoes also do for wedges and mash); not sweet potatoes or baby potatoes
  if (has(name, 'aardappel') && !has(name, 'zoete', 'krieltje')) prefer.push(/(?<!on)geschild|stamppot/);
  // Chicken ready cut
  if (has(name, 'kip', 'kipfilet', 'kipdij')) prefer.push(/reepjes|blokjes|stukjes|roerbak|shoarma/);

  const organic = has(name, 'melk', 'yoghurt', 'kwark', 'karnemelk', 'kefir', '\\w*room\\b', 'crème fraîche', 'creme fraiche',
    'ei\\b', 'eieren', '\\w*gehakt', 'rookworst', 'rundvlees', 'biefstuk', 'spek', 'aardbei', 'framboos', 'frambozen',
    'blauwe bes', 'bessen', 'bramen', 'druif', 'druiven')
    || (isWinter(date) && has(name, 'paprika', 'snoeptomaat', 'cherrytomaat', 'tomaatjes', 'spinazie', 'sla\\b',
      'rucola', 'veldsla', 'andijvie', 'boerenkool', 'snijbiet'));

  let elsewhere: string | null = null;
  if (has(name, 'brood\\b', 'stokbrood', 'ciabatta', 'boterham', 'desem')) elsewhere = 'brood komt van de bakker';
  else if (/^(geraspte )?(jonge |jong belegen |belegen |extra belegen |oude |goudse )?kaas$/.test(name) || has(name, 'gouda'))
    elsewhere = 'kaas komt van de kaasboer';
  else if (has(name, 'haring')) elsewhere = 'haring komt van de visboer';
  else if (has(name, ...CUPBOARD) && !has(name, ...FRESH_HERBS) && !FRESH_CHILI.test(name))
    elsewhere = 'voorraadkast';
  else if (productGroup === 'kruiden' && !has(name, ...FRESH_HERBS) && !has(name, 'vers')
    && !/\b(bos|bosje|takje|takjes|handje|blaadjes)\b/.test(quantity ?? '')) elsewhere = 'voorraadkast';

  return { frozen, organic, prefer, avoid, elsewhere };
}

/** Whether a product goes against the wish for fresh or frozen. */
export function frozenMismatch(wish: ItemWish, facts: ProductFacts): boolean {
  return wish.frozen !== null && wish.frozen !== facts.frozen;
}

export interface Candidate<T> {
  product: T;
  facts: ProductFacts;
  /** Packs it takes and how much is left over (0 = exactly right), when known. */
  waste: number | null;
}

/**
 * Best fit first. Fresh/frozen against the wish counts heaviest, then the
 * things Han asked for (volkoren, blik, geschild, bio where it matters), then
 * the house brand, then a pack size with little left over; Picnic's own order
 * breaks ties.
 */
export function rank<T extends { name: string }>(wish: ItemWish, candidates: Candidate<T>[]): Candidate<T>[] {
  const score = (c: Candidate<T>, index: number) => {
    const name = c.product.name.toLowerCase();
    let s = 0;
    if (frozenMismatch(wish, c.facts)) s -= 100;
    for (const p of wish.prefer) if (p.test(name)) s += 6;
    for (const p of wish.avoid) if (p.test(name)) s -= 6;
    if (wish.organic && c.facts.organic) s += 4;
    if (c.facts.houseBrand) s += 3;
    if (c.waste !== null) s -= Math.min(c.waste, 2);
    return s - index * 0.25;
  };
  return candidates
    .map((c, i) => ({ c, s: score(c, i) }))
    .sort((a, b) => b.s - a.s)
    .map(({ c }) => c);
}
