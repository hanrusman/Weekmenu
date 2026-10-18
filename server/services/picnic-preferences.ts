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
  /** Name patterns that make it a worse fit (dried or seasoned pulses, ready-made dishes). */
  avoid: RegExp[];
  /** The thing itself ("yoghurt" for "griekse yoghurt", "kikkererwten" for "… uit blik"). */
  head: string;
  /** Every thing that will do: the head, the other options the recipe names and known other names. */
  heads: string[];
  /** The item as asked, cleaned: words of a product made from something else must appear here. */
  item: string;
  /** The other words that say which one ("griekse", "witte"); a product that has them fits better. */
  qualifiers: string[];
  /** Yoghurt, quark or custard with no flavour named: a product without a flavour is the plain kind. */
  plainDairy: boolean;
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
    // Dried or seasoned, unless that is what the recipe asks for ("bruine bonen in tomatensaus")
    for (const p of [/gedroogd|\bdroge?\b/, /saus/, /\bgekruid/, /curry/, /chili/]) if (!p.test(name)) avoid.push(p);
    // Red and yellow lentils are sold dried; lentils come from a tin even when the recipe says red
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

  // Ready-made or processed (dip, salade, soep, rauwkost, gesneden …) unless the recipe asks for it
  // or it is what Han prefers anyway (pre-cut chicken)
  for (const p of PROCESSED) {
    if (!p.test(name) && !prefer.some((q) => q.source === p.source)) avoid.push(p);
  }

  const { head, qualifiers: words, options } = headOf(name);
  // Lentils come from a tin whatever colour the recipe names
  const qualifiers = has(name, 'linzen') ? words.filter((w) => !/^(rode|gele|groene|bruine|zwarte)$/.test(w)) : words;
  // Plain yoghurt, quark or custard: a flavour makes another product unless the recipe names it
  const dairy = /^(yoghurt|kwark|skyr|vla)$/.test(head);
  if (dairy) {
    for (const p of FLAVOURS) if (!p.test(name)) avoid.push(p);
  }
  const plainDairy = dairy && !FLAVOURS.some((p) => p.test(name));
  const heads = [...new Set([head, ...options.map((o) => headOf(o).head), ...(SYNONYMS[head] ?? []),
    ...Object.entries(PHRASE_SYNONYMS).filter(([phrase]) => name.includes(phrase)).flatMap(([, names]) => names)])];
  return { frozen, organic, prefer, avoid, elsewhere, head, heads, item: cleanItem(name), qualifiers, plainDairy };
}

// Words that make a product something made from the item rather than the item itself
const PROCESSED = [
  /(dip|salade|soep|saus|chips|spread|tapenade|smoothie|pesto|wokmix|roerbakmix|maaltijd|pakket|rauwkost)\b/,
  /\w+ringen\b|\bspiesjes?\b|\bburgers?\b|\bschnitzels?\b/,
  /gesneden|geraspt|gemarineerd|\bknoflook(?!(teen|teentjes|bol|bollen)\b)\w+/,
];

// Words that say nothing about which product: how it is sold, size, freshness
const NOT_QUALIFYING = new Set(['vers', 'verse', 'grote', 'groot', 'kleine', 'klein', 'middelgrote', 'bio', 'biologische',
  'uit', 'in', 'van', 'de', 'het', 'een', 'met', 'en', 'of', 'blik', 'pot', 'stuk', 'stuks',
  // Frozen is told by Picnic's characteristic, not by the name
  'diepvries', 'diepgevroren', 'bevroren', 'vriesverse']);

/**
 * The item as one thing to look for: without what is in brackets and without
 * the other options ("witvisfilet (kabeljauw of koolvis)" → "witvisfilet",
 * "diepvries frambozen, blauwe bessen of aardbeien" → "diepvries frambozen").
 */
export function cleanItem(itemName: string): string {
  return itemName.trim().toLowerCase().replace(/\([^)]*\)/g, ' ').split(/,|\s+of\s+/)[0].replace(/\s+/g, ' ').trim();
}

/** The other options the recipe names, in brackets or after a comma or "of". */
function optionsOf(itemName: string): string[] {
  const name = itemName.trim().toLowerCase();
  const bracketed = [...name.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/,|\s+of\s+/));
  const listed = name.replace(/\([^)]*\)/g, ' ').split(/,|\s+of\s+/).slice(1);
  return [...bracketed, ...listed].map((o) => o.replace(/\s+/g, ' ').trim()).filter((o) => o.length > 1);
}

/** The item's main word, the words that qualify it, and the other options; "… uit blik" is how, not what. */
export function headOf(itemName: string): { head: string; qualifiers: string[]; options: string[] } {
  const core = cleanItem(itemName).replace(/\s+(uit|in|op|met|van)\s+.*$/, '');
  const words = core.split(/\s+/).filter(Boolean);
  const head = words[words.length - 1] ?? core;
  return { head, qualifiers: words.slice(0, -1).filter((w) => !NOT_QUALIFYING.has(w)), options: optionsOf(itemName) };
}

/**
 * What to search Picnic for, best first: the cleaned item, then the other
 * options (with "diepvries" kept when the item says it), then known other
 * names, then the item without "diepvries".
 */
export function searchQueries(itemName: string): string[] {
  const main = cleanItem(itemName);
  const frozenWord = main.match(FROZEN_WORDS)?.[0];
  const { head, options } = headOf(itemName);
  const synonyms = [...(SYNONYMS[head] ?? []),
    ...Object.entries(PHRASE_SYNONYMS).filter(([phrase]) => main.includes(phrase)).flatMap(([, names]) => names)];
  const plain = frozenWord ? main.replace(FROZEN_WORDS, '').replace(/\s+/g, ' ').trim() : '';
  return [...new Set([main, ...options.map((o) => (frozenWord && !FROZEN_WORDS.test(o) ? `${frozenWord} ${o}` : o)),
    ...synonyms, plain].filter(Boolean))];
}

// Other names Picnic sells a thing under
const SYNONYMS: Record<string, string[]> = {
  amandelmelk: ['amandel drink', 'amandeldrink'],
  havermelk: ['haver drink', 'haverdrink'],
  sojamelk: ['soja drink', 'sojadrink'],
  rijstmelk: ['rijst drink', 'rijstdrink'],
  kokosdrink: ['kokos drink'],
  parmezaan: ['parmigiano', 'grana padano', 'parmezaanse kaas'],
  rijstnoedels: ['mihoen'],
  kokosrasp: ['geraspte kokos'],
};
// … and for a whole phrase
const PHRASE_SYNONYMS: Record<string, string[]> = {
  'pinda en rozijn': ['studentenhaver'],
  'rozijnen en pinda': ['studentenhaver'],
};

// A word at the end of a product word that makes it another product, carrying the item as a flavour
// (roomkaas gember, sorbetijs mango, kokosolie, ribbelchips peper & zout, havermoutpap)
const CARRIERS = /(roomkaas|smeerkaas|ijs|sorbet|olie|chips|pap|thee|sap|siroop|limonade|frisdrank|yoghurt|kwark|vla|toetje|koekjes?|repen|reep|chocolade|snoep|drop|dressing|spread|hummus|jam|confituur|chutney|crackers?|wafels?|muesli|granola|cruesli|smoothie|taart|cake|pizza|soep|saus|salade|dip|drank)$/;

// Flavours that make plain yoghurt, quark or custard another product
const FLAVOURS = [/vanille|aardbei|perzik|kersen?\b|framboos|frambozen|banaan|stracciatella|mango|bosvruchten|bosbes|blauwe bes|honing|citroen|limoen|chocola|kokos|abrikoos|appel|peer\b|peren|ananas|rabarber|pruim|karamel|caramel|koffie|muesli|granen|kiwi|passievrucht|sinaasappel|cranberr|bramen|braam|fruit|hazelnoot|nougat|pistache|tropisch|zomer/];

// Qualifiers that ask for the plain kind of a dairy product: met without the word when no flavour is named
const PLAIN = /^(natuurlijke?|naturel|neutrale?|plain)$/;

/** A word in its plain form, so inflections compare equal: rode/rood, witte/wit, griekse/grieks, gele/geel. */
const plainForm = (w: string) => w.replace(/e$/, '').replace(/([aeou])\1/g, '$1').replace(/([^aeiou])\1$/, '$1');

/** Whether a product name has a qualifying word, in any inflection, as a word or the start of one. */
export function hasQualifier(productName: string, qualifier: string): boolean {
  const words = productName.toLowerCase().split(/[\s-]+/);
  return [qualifier, ...(QUALIFIER_SYNONYMS[qualifier] ?? [])].map(plainForm)
    .some((q) => words.some((w) => plainForm(w).startsWith(q)));
}

// Qualifiers Picnic writes another way
const QUALIFIER_SYNONYMS: Record<string, string[]> = {
  // Not 'natuur': the brand Pur Natur says nothing about the flavour
  natuurlijke: ['naturel', 'neutraal'],
  naturel: ['natuurlijk', 'neutraal'],
  ongezoete: ['ongezoet', 'zonder suiker'],
};

// A cut or the way it grows still is the thing: kipfilet → kipfiletreepjes, knoflook → knoflookbollen
const CUT_TAILS = /^((reepjes|blokjes|stukjes|plakjes|haasjes|dij)?(filets?)?|bol(len)?|teen(tjes)?|tenen|stengels?|knol(len)?|krop(pen)?)$/;
const ENDINGS = ['eren', 'tjes', 'jes', 'tje', 'je', "'s", 'se', 'en', 's', 'n', 'e'];

/**
 * A noun's possible forms without plural or diminutive ending and with
 * doubled letters made single, so tomaat/tomaten/tomaatjes, boon/bonen/
 * boontjes and bes/bessen share one.
 */
function nounStems(word: string): string[] {
  // Every ending that fits is tried: tomaatjes is tomaat + jes, not tomaa + tjes
  const bare = [word, ...ENDINGS.filter((e) => word.endsWith(e) && word.length - e.length >= 2).map((e) => word.slice(0, -e.length))];
  return bare.map((w) => w.replace(/([aeou])\1/g, '$1').replace(/([^aeiou])\1$/, '$1'));
}

/**
 * Whether a product is the item itself: its main word stands in the name on
 * its own or at the end of a compound (uien, babyspinazie, kipfiletreepjes),
 * not at the start of something else (uienringen, komkommersalade, linzensoep).
 */
export function isRelevant(wish: Pick<ItemWish, 'head'> & Partial<Pick<ItemWish, 'heads' | 'item'>>, productName: string): boolean {
  const name = productName.toLowerCase().replace(/[®™()]/g, ' ');
  const words = name.split(/[\s-]+/).filter(Boolean);
  const heads = wish.heads ?? [wish.head];
  // Known other names count as written ("amandel drink" for amandelmelk)
  if (heads.some((h) => h.includes(' ') && name.includes(h))) return true;
  // A product that carries the item as a flavour is another product, unless the item asks for that carrier
  const item = wish.item ?? wish.head;
  if (words.some((w) => { const c = w.match(CARRIERS)?.[1]; return !!c && !item.includes(c); })) return false;
  return heads.filter((h) => !h.includes(' ')).some((head) => {
    // The item's stem not so short that it ends many words (kaas → ka would match paprika); ui and ei stay
    const stems = nounStems(head).filter((w) => w.length >= Math.min(3, head.length));
    return words.some((w) => {
      if (nounStems(w).some((form) => stems.some((stem) => form.endsWith(stem)))) return true;
      const at = w.indexOf(head);
      return at >= 0 && CUT_TAILS.test(w.slice(at + head.length));
    });
  });
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
  /** What the packs it takes cost together, in cents, when known. */
  cost?: number | null;
}

/**
 * Best fit first. Fresh/frozen against the wish counts heaviest, then whether
 * it is the item itself and not something made from it, then the things Han
 * asked for (volkoren, blik, geschild, bio where it matters) and the words the
 * recipe qualifies it with, the house brand, the price against the cheapest
 * fitting choice, and a pack size with little left over; Picnic's own order
 * breaks ties.
 */
export function rank<T extends { name: string }>(wish: ItemWish, candidates: Candidate<T>[]): Candidate<T>[] {
  const fits = (c: Candidate<T>) => !frozenMismatch(wish, c.facts) && isRelevant(wish, c.product.name);
  const anyRelevant = candidates.some((c) => isRelevant(wish, c.product.name));
  const costs = candidates.filter((c) => fits(c) && c.cost).map((c) => c.cost!);
  const cheapest = costs.length ? Math.min(...costs) : null;
  const score = (c: Candidate<T>, index: number) => {
    const name = c.product.name.toLowerCase();
    let s = 0;
    if (frozenMismatch(wish, c.facts)) s -= 100;
    // Only counts when something does fit: otherwise the name may just differ (mihoen for rijstnoedels)
    if (anyRelevant && !isRelevant(wish, name)) s -= 30;
    for (const p of wish.prefer) if (p.test(name)) s += 6;
    for (const p of wish.avoid) if (p.test(name)) s -= 6;
    // A word the recipe qualifies the item with (griekse, witte, rode) makes another product when missing
    for (const q of wish.qualifiers) {
      if (hasQualifier(name, q)) continue;
      // "natuurlijke yoghurt": a yoghurt without a flavour is natural, whatever its name says
      if (PLAIN.test(q) && wish.plainDairy && !FLAVOURS.some((p) => p.test(name))) continue;
      s -= 4;
    }
    if (wish.organic && c.facts.organic) s += 4;
    if (c.facts.houseBrand) s += 3;
    // Twice the price of the cheapest fitting choice costs 3 points, three times about 5
    if (cheapest && c.cost) s -= 3 * Math.log2(c.cost / cheapest);
    if (c.waste !== null) s -= Math.min(c.waste, 2);
    return s - index * 0.25;
  };
  return candidates
    .map((c, i) => ({ c, s: score(c, i) }))
    .sort((a, b) => b.s - a.s)
    .map(({ c }) => c);
}
