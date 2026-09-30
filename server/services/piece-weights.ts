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

// Words that describe a product without changing its weight much
const DESCRIPTIVE = /^(?:rode|gele|groene|oranje|bonte|witte|grote|kleine|middelgrote|verse|jonge|biologische)\s+/;

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
 * How many `baseUnit` one `unit` of this ingredient is, from the typical
 * weights: "1 stuks aubergine = 300 g", "1 g aubergine = 1/300 stuks",
 * "1 krop bloemkool = 1 stuks". Undefined when either unit has no weight.
 */
export function defaultFactor(name: string, unit: string, baseUnit: string): number | undefined {
  if (unit === baseUnit) return undefined;
  const weights = weightsFor(name);
  if (!weights) return undefined;
  const grams = (u: string) => (u === 'g' ? 1 : weights[u as keyof Weights]);
  const from = grams(unit);
  const to = grams(baseUnit);
  return from !== undefined && to !== undefined ? from / to : undefined;
}
