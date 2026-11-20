import type Database from 'better-sqlite3';
import { keyWords, sameWord } from './ingredient-words.js';
import { Line, isVegetable, linesOf, weigh } from './vegetables.js';

/**
 * How big a portion gets when vegetables are added to a recipe. The recipe as
 * it was written is left alone, however rich in vegetables. What a top-up adds
 * has to fit the plate: cooked into a soup or a sauce nearly anything goes,
 * next to the dish a normal salad, and otherwise not past what a person
 * finishes. Something else may give way for it: pasta goes by what the family
 * cooks, not by what the cookbook says.
 */

/** Per serving, what a top-up may bring a dish to whose vegetables are not cooked into a soup or sauce. */
export const TOP_UP_CEILING = 400;
/** Per serving, the salad or raw vegetables a top-up may put next to a dish. */
export const SIDE_SALAD = 200;
/** Grams of dry pasta the family cooks for the household (four servings), whatever the recipe says. */
export const PASTA_BASE = 250;
const PASTA_SERVINGS = 4;

/** The family's measure of dry pasta for a recipe of this many servings. */
export function pastaFor(servings: number): number {
  return PASTA_BASE * servings / PASTA_SERVINGS;
}

// A dish that is its sauce or its pan: vegetables cook down in it and a big portion is easy to eat
const WET_KINDS = new Set(['soep', 'stamppot', 'curry', 'stoof']);
const WET_NAME = /soep|curry|stoof|stamppot|hutspot|bolognese|rag[uù]\b|chili|dahl|daal|shakshuka|risotto|lasagne|ovenschotel|goulash|tajine|ratatouille|pastasaus/i;
// ... or has a sauce to cook them in: tomatoes from a tin, coconut milk, cream. Not the passata on a pizza
const SAUCE_BASE = /passata|gezeefde tomaten|tomatenblokjes|gepelde tomaten|pelati|polpa|pelaten|tomaten uit blik|tomatensaus|kokosmelk|kookroom|slagroom/;
const SAUCE_GRAMS = 200;
const NO_SAUCE_DISH = /pizza|flammkuchen|plaattaart|quesadilla|wrap|taco/i;

/**
 * Whether a dish cooks its vegetables into a soup, a stew or a sauce. By what
 * kind of dish it is and what it is called, or by a sauce among its
 * ingredients. A sauce in the name alone ("met satésaus") says nothing.
 */
export function isWetDish(dish: { name: string; meal_type?: string | null }, lines: Line[]): boolean {
  if (WET_KINDS.has(dish.meal_type ?? '') || WET_NAME.test(dish.name)) return true;
  if (NO_SAUCE_DISH.test(dish.name)) return false;
  const sauce = lines.filter((l) => SAUCE_BASE.test(l.name.toLowerCase())).reduce((sum, l) => sum + (weigh(l) ?? 0), 0);
  return sauce >= SAUCE_GRAMS;
}

// Vegetables that go on the table raw, next to the dish or as a salad
const SALAD = /komkommer|\bsla\b|little gem|ijsbergsla|romaine|bladsla|kropsla|eikenblad|slamelange|rucola|veldsla|radijs|rauwkost|snoep|cherrytoma|kerstoma|trostoma|\btoma(at|ten)\b|avocado|witte kool|rode kool|spitskool/;

/** Whether a vegetable is the kind that is served raw: a top-up that adds it, adds a salad. */
export function isSaladVegetable(name: string): boolean {
  const n = name.toLowerCase();
  return SALAD.test(n) && !/blik|blokjes|gepeld|puree|saus/.test(n);
}

// Tomatoes and cabbage go either way: raw next to the dish, or into the pan or the oven
const EITHER_WAY = /toma|kool/;
const HEATED = /\b(mee)?(bak|kook|stoof|stov|smoor|roerbak|wok|rooster|grill|sudder|stoom|blancheer|pruttel)|\boven\b|pan\b|ovenschaal/i;
const SERVED_RAW = /salade|rauwkost|dressing|\brauw/i;

/**
 * Whether the steps cook a vegetable that is also served raw: a sentence that
 * names it puts it in a pan, a pot or the oven, and is not about a salad.
 * Roasted cherry tomatoes through the pasta are no salad next to it.
 */
export function isCookedIn(name: string, steps: string[]): boolean {
  if (!EITHER_WAY.test(name.toLowerCase())) return false;
  const words = keyWords(name);
  return steps.flatMap((step) => step.split(/(?<=[.!?;:])\s+/)).some((sentence) => {
    const tokens = sentence.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/);
    return words.some((w) => tokens.some((t) => sameWord(w, t))) && HEATED.test(sentence) && !SERVED_RAW.test(sentence);
  });
}

// Pasta by its shape; "currypasta" and "misopasta" are no pasta, fresh and filled pasta weigh differently
const PASTA = /\b(pasta|spaghetti|penne|fusilli|farfalle|macaroni|linguine|tagliatelle|fettuccine|pappardelle|bucatini|orecchiette|rigatoni|conchiglie|schelpjes|paccheri|ditalini|capellini|gemelli|casarecce|trofie|ziti|orzo|risoni)\b/;
const NOT_DRY_PASTA = /\bvers|gevuld|tortellini|ravioli|gnocchi|lasagne|saus|salade|pesto/;

/** Whether an ingredient line is dry pasta measured by weight. */
export function isDryPasta(line: Line): boolean {
  const n = line.name.toLowerCase();
  return PASTA.test(n) && !NOT_DRY_PASTA.test(n) && !['sauzen', 'kruiden'].includes(line.group) && ['g', 'kg'].includes(line.unit);
}

/** A vegetable line of a recipe after its top-up, split in what the recipe had and what was added. */
export interface TopUpPart {
  line: Line;
  /** Which of the recipe's ingredients it is. */
  index: number;
  grams: number;
  /** The grams of it the recipe had before its top-up. */
  own: number;
  /** Served raw, going by its name and by what the steps do with it: what was added of it is a salad next to the dish. */
  salad: boolean;
}

/** Whether two ingredient names are the same thing: the same library name, or a word that says what it is in common. */
function sameIngredient(a: string, b: string): boolean {
  if (a === b) return true;
  const words = keyWords(b);
  return keyWords(a).some((w) => words.some((x) => sameWord(w, x)));
}

type Ingredients = Array<{ name: string; amount: number | string | null; unit: string; product_group?: string }>;

/** The ingredient lines of a list, weighable or not, as the library names them. */
export function linesFor(db: Database.Database, ingredients: Ingredients): Line[] {
  return linesOf(db, ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })));
}

/**
 * The vegetables of a recipe that can be weighed, each with what the recipe
 * had of it before its top-up (`original`). A vegetable the top-up gave a name
 * that matches nothing (cavolo nero that became boerenkool) is still in there:
 * what the original had under a name no line has anymore counts as the
 * recipe's own over the lines that match nothing, by their size, so the whole
 * never counts as less than the recipe had. `steps` are the recipe's as it is
 * now: they tell a tomato that goes into the pan from one in a salad.
 */
export function topUpParts(db: Database.Database, current: Ingredients, original: Ingredients, steps: string[] = []): TopUpPart[] {
  const weighed = (ingredients: Ingredients) => linesFor(db, ingredients)
    .filter((line) => isVegetable(line.name, line.group))
    .map((line) => ({ line, index: line.index!, grams: weigh(line) ?? 0 }))
    .filter((v) => v.grams > 0);
  const now = weighed(current);
  const kept = new Map<number, number>();
  let renamed = 0;
  for (const o of weighed(original)) {
    const same = now.filter((v) => v.line.name === o.line.name);
    const matches = same.length ? same : now.filter((v) => sameIngredient(v.line.name, o.line.name));
    if (matches.length === 0) {
      renamed += o.grams;
      continue;
    }
    const total = matches.reduce((sum, v) => sum + v.grams, 0);
    // Spread over the lines it became, by their size
    for (const v of matches) kept.set(v.index, (kept.get(v.index) ?? 0) + o.grams * (v.grams / total));
  }
  const unmatched = now.filter((v) => !kept.has(v.index));
  const unmatchedTotal = unmatched.reduce((sum, v) => sum + v.grams, 0);
  for (const v of unmatched) if (renamed > 0) kept.set(v.index, renamed * (v.grams / unmatchedTotal));
  return now.map((v) => ({
    ...v,
    own: Math.min(v.grams, kept.get(v.index) ?? 0),
    salad: isSaladVegetable(v.line.name) && !isCookedIn(v.line.name, steps),
  }));
}

export interface TopUpRoom {
  /** The dish cooks its vegetables into a soup or sauce. */
  wet: boolean;
  /** Grams (whole recipe) of salad the top-up put next to the dish, and how much of that fits. */
  salad: number;
  saladRoom: number;
  /** Grams (whole recipe) the top-up added in all, and how much of that fits once the salad does. */
  added: number;
  addedRoom: number;
}

/**
 * How much of what a top-up added fits the plate. Next to the dish a normal
 * salad, or as much more as it takes to reach `floor` grams a serving (the
 * vegetable aim) with it. In all, for a dish that is no soup or sauce, up to
 * the ceiling; the recipe's own vegetables count towards it but are never
 * what gives way.
 */
export function topUpRoom(parts: TopUpPart[], wet: boolean, servings: number, floor: number): TopUpRoom {
  const sum = (pick: (p: TopUpPart) => number) => parts.reduce((total, p) => total + pick(p), 0);
  const own = sum((p) => p.own);
  const salad = sum((p) => (p.salad ? p.grams - p.own : 0));
  const cooked = sum((p) => (p.salad ? 0 : p.grams - p.own));
  const saladRoom = Math.min(salad, Math.max(SIDE_SALAD * servings, floor * servings - own - cooked));
  const added = salad + cooked;
  const fits = saladRoom + cooked;
  const addedRoom = wet ? fits : Math.min(fits, Math.max(TOP_UP_CEILING * servings - own, floor * servings - own, 0));
  return { wet, salad, saladRoom, added, addedRoom };
}

/**
 * What is too much about a top-up, in words a model can act on; empty when it
 * fits. `floor` is the vegetable aim per serving the top-up is after.
 */
export function topUpObjections(parts: TopUpPart[], wet: boolean, servings: number, floor: number): string[] {
  const room = topUpRoom(parts, wet, servings, floor);
  const per = (grams: number) => Math.round(grams / servings);
  const objections: string[] = [];
  // A little over is not worth another round
  if (room.salad > room.saladRoom * 1.1) {
    objections.push(`${per(room.salad)} g salade of rauwkost per portie erbij; ernaast past een gewone salade van hooguit ${per(room.saladRoom)} g`);
  }
  const total = parts.reduce((sum, p) => sum + p.grams, 0);
  if (!wet && room.saladRoom + (room.added - room.salad) > room.addedRoom * 1.05) {
    objections.push(`${per(total)} g groente per portie, boven de ${TOP_UP_CEILING} g: bij een gerecht zonder soep of saus krijgt het gezin dat niet op`);
  }
  return objections;
}
