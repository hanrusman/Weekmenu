/**
 * Typical weight in grams of one piece (or head, bunch, stalk, clove, bag)
 * of common vegetables, as sold in a Dutch supermarket. Used as a fallback so
 * "2 aubergines" and "300 g aubergine" add up on the shopping list without a
 * conversion set by hand; a conversion set in the ingredient manager wins.
 */
type Weights = Partial<Record<'stuks' | 'krop' | 'bos' | 'stengel' | 'teen' | 'bol' | 'zak' | 'cm', number>>;

const WEIGHTS: Record<string, Weights> = {};

function add(weights: Weights, ...names: string[]) {
  for (const name of names) WEIGHTS[name] = weights;
}

// Onions and garlic
add({ stuks: 100 }, 'ui', 'rode ui', 'gele ui');
add({ stuks: 30 }, 'sjalot');
add({ stuks: 15, bos: 100 }, 'bosui');
add({ teen: 5, bol: 50 }, 'knoflook');
add({ stuks: 200 }, 'prei');
// Fruit vegetables
add({ stuks: 100 }, 'tomaat', 'trostomaat', 'trostomaten');
add({ stuks: 70 }, 'pruimtomaat', 'pruimtomaten');
add({ stuks: 15 }, 'cherrytomaat', 'kerstomaat', 'kerstomaatje', 'kerstomaatjes', 'kersentomaat', 'kersentomaten');
add({ stuks: 150 }, 'paprika', 'puntpaprika');
add({ stuks: 250 }, 'courgette');
add({ stuks: 300 }, 'aubergine');
add({ stuks: 400 }, 'komkommer');
add({ stuks: 15 }, 'rode peper', 'chilipeper', 'rode chilipeper', 'spaanse peper', 'rode spaanse peper', 'chili', 'rode chili');
add({ stuks: 1200 }, 'butternutpompoen', 'flespompoen');
add({ stuks: 1500 }, 'pompoen');
// Roots and tubers
add({ stuks: 100 }, 'wortel');
// Varieties that are aliases of a product above but weigh differently per
// piece: looked up by the name as written in the recipe, before aliasing
add({ stuks: 200 }, 'winterpeen', 'winterwortel', 'winterwortels', 'winterwortelen');
add({ stuks: 50 }, 'bospeen', 'uitje', 'uitjes');
add({ stuks: 15 }, 'baby-wortel', 'babywortel');
add({ stuks: 150 }, 'aardappel');
add({ stuks: 250 }, 'zoete aardappel');
add({ stuks: 150 }, 'pastinaak', 'biet', 'rode biet');
add({ stuks: 700 }, 'knolselderij');
add({ stuks: 10, bos: 200 }, 'radijs');
add({ cm: 5 }, 'gember');
// Cabbages and heads
add({ stuks: 800, krop: 800 }, 'bloemkool');
add({ stuks: 400, krop: 400 }, 'broccoli');
add({ stuks: 800, krop: 800 }, 'spitskool', 'savooiekool', 'savoy-kool', 'chinese kool');
add({ stuks: 1000, krop: 1000 }, 'witte kool', 'rode kool');
add({ stuks: 125 }, 'witlof');
add({ stuks: 250 }, 'venkel', 'venkelbol');
add({ stuks: 500, stengel: 40 }, 'bleekselderij');
add({ stuks: 50 }, 'asperge', 'asperges');
add({ stuks: 200 }, 'paksoi');
// Mushrooms
add({ stuks: 20 }, 'champignon', 'kastanjechampignon', 'kastanjechampignons');
add({ stuks: 80 }, 'portobello', 'portobello champignon');
// Leaves
add({ stuks: 150, krop: 150 }, 'little gem');
add({ stuks: 500, krop: 500 }, 'ijsbergsla', 'andijvie');
add({ stuks: 300, krop: 300 }, 'sla', 'frisée', 'kropsla');
add({ zak: 75 }, 'rucola');
add({ zak: 300 }, 'spinazie');
add({ zak: 100 }, 'veldsla');

// Words that describe a product without changing its weight per piece. Size
// words (grote, kleine, jonge) do change it, so those are deliberately absent.
const DESCRIPTIVE = /^(?:rode|gele|groene|oranje|bonte|witte|verse|biologische)\s+/;

/** The weights for a name, directly or after dropping describing words ("rode paprika" → paprika). */
function weightsFor(name: string): Weights | undefined {
  let current = name.toLowerCase().trim();
  for (;;) {
    if (WEIGHTS[current]) return WEIGHTS[current];
    const shorter = current.replace(DESCRIPTIVE, '');
    if (shorter === current) return undefined;
    current = shorter;
  }
}

/**
 * Which product to look the weight up for. The name as written in the recipe
 * (`variant`, e.g. "winterpeen") comes first, since an alias need not weigh
 * the same as its canonical ingredient; then the ingredient's current name;
 * then its aliases, but only when they agree, so a rename ("tomaat" →
 * "tomaten") keeps the weight.
 */
export interface WeightLookup {
  variant?: string | null;
  name: string;
  aliases?: string[];
}

function weightsForProduct(product: string | WeightLookup): Weights | undefined {
  if (typeof product === 'string') return weightsFor(product);
  const direct = (product.variant ? weightsFor(product.variant) : undefined) ?? weightsFor(product.name);
  if (direct) return direct;
  const viaAliases = (product.aliases ?? []).map(weightsFor).filter((w): w is Weights => w !== undefined);
  const key = (w: Weights) => JSON.stringify(Object.entries(w).sort());
  return viaAliases.length > 0 && viaAliases.every((w) => key(w) === key(viaAliases[0])) ? viaAliases[0] : undefined;
}

/**
 * How many `baseUnit` one `unit` of this ingredient is, from the typical
 * weights: "1 stuks aubergine = 300 g", "1 g aubergine = 1/300 stuks",
 * "1 krop bloemkool = 1 stuks". Undefined when either unit has no weight.
 */
export function defaultFactor(product: string | WeightLookup, unit: string, baseUnit: string): number | undefined {
  if (unit === baseUnit) return undefined;
  const weights = weightsForProduct(product);
  if (!weights) return undefined;
  const grams = (u: string) => (u === 'g' ? 1 : weights[u as keyof Weights]);
  const from = grams(unit);
  const to = grams(baseUnit);
  return from !== undefined && to !== undefined ? from / to : undefined;
}
