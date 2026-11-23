import type Database from 'better-sqlite3';
import { keyWords, sameWord } from './ingredient-words.js';
import { normalizeUnit, parseAmount } from './ingredients.js';
import { Line, isVegetable, linesOf, weigh } from './vegetables.js';

/**
 * How big a portion gets when vegetables are added to a recipe. The recipe as
 * it was written is left alone, however rich in vegetables. What a top-up adds
 * has to fit the plate: cooked into a soup or a sauce nearly anything goes,
 * next to the dish a normal salad, and otherwise not past what a person
 * finishes. Something else may give way for it: pasta, rice and the like go by
 * what the family cooks, not by what the cookbook says, and what comes off
 * there is room for vegetables.
 */

/** Per serving, what a top-up may bring a dish to whose vegetables are not cooked into a soup or sauce. */
export const TOP_UP_CEILING = 400;
/** Per serving, the salad or raw vegetables a top-up may put next to a dish. */
export const SIDE_SALAD = 200;
/** Grams of dry pasta, rice, noodles or grains the family cooks: for an adult, and for a child. */
export const CARBS_ADULT = 80;
export const CARBS_CHILD = 45;
// The household the recipes are written for: two adults and two children on four servings
const HOUSEHOLD = { adults: 2, children: 2 };
/** ... which makes for the household (four servings), whatever the recipe says. */
export const CARBS_BASE = HOUSEHOLD.adults * CARBS_ADULT + HOUSEHOLD.children * CARBS_CHILD;
/**
 * A recipe that asks more than this many times the measure asks much more, and
 * goes down to the measure. The 300 g of most cookbooks is a little more: the
 * cook takes a little less, the recipe stays as it is.
 */
export const CARBS_MUCH_MORE = 1.2;
/** Cooked, pasta and rice weigh about this many times their dry weight: what comes off makes that much room on the plate. */
export const COOKED_FROM_DRY = 2.5;
/** Per serving: more rice or noodles than this in a recipe is cooked or fresh weight, whatever its name says. */
const DRY_GRAIN_AT_MOST = 100;

/** The family's measure of dry pasta, rice and the like for a recipe of this many servings. */
export function carbsFor(servings: number): number {
  return CARBS_BASE * servings / (HOUSEHOLD.adults + HOUSEHOLD.children);
}

/** Whether this many grams of dry pasta or rice is much more than the family cooks for that many servings. */
export function isMuchMoreCarbs(grams: number, servings: number): boolean {
  return Math.round(grams) > Math.round(carbsFor(servings) * CARBS_MUCH_MORE);
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
  return sentencesNaming(name, steps).some((sentence) => HEATED.test(sentence) && !SERVED_RAW.test(sentence));
}

// Pasta by its shape; "currypasta" and "misopasta" are no pasta, fresh and filled pasta weigh differently
const PASTA = /\b(pasta|spaghetti|penne|fusilli|farfalle|macaroni|linguine|tagliatelle|fettuccine|pappardelle|bucatini|orecchiette|rigatoni|conchiglie|schelpjes|paccheri|ditalini|capellini|gemelli|casarecce|trofie|ziti|orzo|risoni)\b/;
const NOT_DRY_PASTA = /\bvers|gevuld|tortellini|ravioli|gnocchi|lasagne|saus|salade|pesto|meel/;
// Rice, noodles and grains that are cooked in water and drained or left to swell
const GRAIN = /rijst|couscous|bulgur|quinoa|noedel|noodle|\bmie\b|mihoen|vermicelli|soba|ramen|freekeh|gierst|farro|\bgort|parelgort/;
// Not that: a flour, a vinegar, rice paper, cauliflower cut like rice, a pouch of ready-made grains, thick fresh
// noodles; and rice that cooks in the liquid of its dish (risotto, paella), where less rice needs less stock too
const NOT_DRY_GRAIN = /meel|azijn|wijn|papier|vel|bloemkool|broccoli|risotto|arborio|carnaroli|pa[eë]lla|grains|granen|graanmix/;
// Cooked, fresh or out of a pouch, by the name or by the note with it ("bijvoorbeeld udon"): that is no dry weight
const NOT_DRY = /(?<!on)gekookt|kant-en-klaar|\bvers|afgekoeld|\bkoud|restje|zakje|magnetron|udon/;

/** Whether an ingredient line is dry pasta measured by weight. */
export function isDryPasta(line: Line, note = ''): boolean {
  const n = line.name.toLowerCase();
  return PASTA.test(n) && !NOT_DRY_PASTA.test(n) && !NOT_DRY.test(`${n} ${note.toLowerCase()}`)
    && !['sauzen', 'kruiden'].includes(line.group) && ['g', 'kg'].includes(line.unit);
}

/**
 * Whether an ingredient line is the carbohydrate of a dinner by its dry
 * weight: pasta, rice, noodles, couscous and the like. `note` is what the
 * recipe says with it ("gekookt", "voorgekookt zakje"); `servings` tells a
 * dry weight from a cooked one that does not say so.
 */
export function isDryCarb(line: Line, note = '', servings = 4): boolean {
  if (isDryPasta(line, note)) return true;
  const n = line.name.toLowerCase();
  if (!GRAIN.test(n) || NOT_DRY_GRAIN.test(n) || NOT_DRY.test(`${n} ${note.toLowerCase()}`)) return false;
  if (['sauzen', 'kruiden'].includes(line.group) || !['g', 'kg'].includes(line.unit)) return false;
  return (weigh(line) ?? 0) <= DRY_GRAIN_AT_MOST * servings;
}

type Ingredients = Array<{ name: string; amount: number | string | null; unit: string; product_group?: string; note?: string | null }>;

/** The ingredient lines of a list, weighable or not, as the library names them. */
export function linesFor(db: Database.Database, ingredients: Ingredients): Line[] {
  return linesOf(db, ingredients.map((i) => ({ ...i, product_group: i.product_group ?? 'overig' })));
}

/** The lines of a recipe that are its dry pasta, rice, noodles or grains. */
export function dryCarbLines(db: Database.Database, ingredients: Ingredients, servings: number): Line[] {
  return linesFor(db, ingredients).filter((line) => isDryCarb(line, ingredients[line.index!]?.note ?? '', servings));
}

// A dish that cooks its pasta or rice in its own sauce or stock: less of it would leave the dish too wet.
// And one that is built of it (a pasta cake, a filling): less of it is another dish
const ONE_POT = /risotto|pa[eë]lla|pilav|pilaf|biryani|jambalaya|orzotto|e[eé]npans|one.?pot|uit [eé][eé]n pan|taart|frittata|koekje|gevuld/i;
const MEASURED_LIQUID = /\d\s*(ml|l|liter|dl|cl)\b|bouillon|kokosmelk/i;
// The water to cook rice in is often given a sentence before the rice: "Breng 800 ml water aan de kook. Spoel de rijst."
const MEASURED_WATER = /\d\s*(ml|l|liter|dl|cl)\s+(\w+\s+){0,2}water/i;
// A cup of the cooking water kept for the sauce is no liquid the pasta cooks in, and neither is water to rinse with
const COOKING_WATER_KEPT = /\d[\d.,]*\s*(ml|l|liter|dl|cl)\s+(\w+\s+){0,3}\w*(kookwater|kookvocht|pastawater)\w*/gi;
const RINSING = /spoel|giet\b.*\baf\b|afgiet/i;
// The rice that goes on the table with it is not what the water just before was for
const SERVING = /serveer|opdien|geef\b.*\berbij|schep\b.*\bop de borden/i;

/** How the steps may call a dry carbohydrate besides by its own name: "de rijst" for basmatirijst, "de pasta" for penne. */
export function carbWords(name: string): string[] {
  const n = name.toLowerCase();
  if (/noedel|noodle|\bmie\b|mihoen|vermicelli|soba|ramen/.test(n)) return ['noedels', 'noedel', 'noodles', 'mie'];
  if (/rijst/.test(n)) return ['rijst'];
  return PASTA.test(n) ? ['pasta'] : [];
}

/** The texts among these that name an ingredient, by its own name or one of `also`. */
function naming(name: string, texts: string[], also: string[] = []): string[] {
  const words = [...keyWords(name), ...also];
  return texts.filter((text) => {
    const tokens = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z]+/);
    return words.some((w) => tokens.some((t) => sameWord(w, t)));
  });
}

/** The sentences of the steps that name an ingredient, by its own name or one of `also`. */
function sentencesNaming(name: string, steps: string[], also: string[] = []): string[] {
  return naming(name, steps.flatMap((step) => step.split(/(?<=[.!?;:])\s+/)), also);
}

/**
 * Whether the pasta or rice of a dish takes up a measured amount of liquid:
 * a one-pot dish by its name, or steps that give the water or stock it cooks
 * or swells in ("giet er 400 ml kokend water bij"). Less of it there asks for
 * less liquid too, which is not for arithmetic to decide. The same goes for a
 * dish that is built of its pasta or rice. `lines` are all the recipe's
 * ingredients: water that is on the list is measured ("breng de rijst met het
 * water aan de kook").
 */
export function cooksInItsLiquid(dish: { name: string }, carbs: Line[], steps: string[], lines: Line[] = []): boolean {
  if (ONE_POT.test(dish.name)) return true;
  const waterListed = lines.some((line) => /\bwater\b/.test(line.name.toLowerCase()) && ['ml', 'l', 'dl'].includes(line.unit));
  const sentences = steps.map((step) => step.split(/(?<=[.!?;:])\s+/).map((sentence) => sentence.replace(COOKING_WATER_KEPT, ' ')));
  return carbs.some((line) => {
    const also = carbWords(line.name);
    return sentences.some((ofStep) => ofStep.some((sentence, at) => {
      if (naming(line.name, [sentence], also).length === 0) return false;
      if (MEASURED_LIQUID.test(sentence)) return true;
      if (waterListed && /\bwater\b/i.test(sentence) && !RINSING.test(sentence)) return true;
      // "Breng 800 ml water aan de kook. Spoel de rijst en voeg toe."
      return at > 0 && MEASURED_WATER.test(ofStep[at - 1]) && !SERVING.test(sentence);
    }));
  });
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

/**
 * The vegetables of a recipe that can be weighed, each with what the recipe
 * had of it before its top-up (`original`).
 *
 * What the recipe had counts as its own on the line it still is, else on a
 * line of the same name, else on one of the same kind, and is never handed
 * out twice. A vegetable the top-up gave a name that matches nothing (cavolo
 * nero that became boerenkool) is still in there: it counts over the lines
 * that match nothing, by their size.
 *
 * The recipe as it was written does not always say how much: "1 krop sla",
 * "2 cup maïs", or a name the weights do not know ("courgette. in
 * ringetjes"). Such a vegetable is the recipe's own all the same. Where the
 * top-up counts it the same way (2 stuks that became 4) the recipe's share is
 * that part; where that cannot be told, all of the line is the recipe's, so
 * nothing of it is ever taken for an addition.
 *
 * `steps` are the recipe's as it is now: they tell a tomato that goes into
 * the pan from one in a salad.
 */
export function topUpParts(db: Database.Database, current: Ingredients, original: Ingredients, steps: string[] = []): TopUpPart[] {
  const now = linesFor(db, current)
    .filter((line) => isVegetable(line.name, line.group))
    .map((line) => ({ line, index: line.index!, grams: weigh(line) ?? 0, raw: current[line.index!] }))
    .filter((v) => v.grams > 0);
  type Now = typeof now[number];
  const kept = new Map<number, number>();
  const give = (v: Now, grams: number) => kept.set(v.index, Math.min(v.grams, (kept.get(v.index) ?? 0) + grams));
  const written = (name: string) => name.toLowerCase().trim();
  /** The lines a vegetable of the recipe is now: the line it still is, else its name, else its kind. */
  const linesOfIt = (rawName: string, name: string): Now[] => {
    const still = now.filter((v) => written(v.raw.name) === written(rawName));
    if (still.length) return still;
    const named = now.filter((v) => v.line.name === name);
    return named.length ? named : now.filter((v) => sameIngredient(v.line.name, name) || sameIngredient(v.raw.name, rawName));
  };

  const originalLines = linesFor(db, original);
  const unweighed: Array<{ raw: Ingredients[number]; name: string }> = [];
  let renamed = 0;
  original.forEach((raw, at) => {
    const line = originalLines.find((l) => l.index === at);
    const vegetable = !!line && isVegetable(line.name, line.group);
    const grams = line ? weigh(line) : null;
    if (line && grams !== null && grams > 0) {
      const lines = linesOfIt(raw.name, line.name);
      if (lines.length === 0) {
        // Only a vegetable that went missing is looked for under another name
        if (vegetable) renamed += grams;
        return;
      }
      // Also what the list did not file as a vegetable when the recipe came in ("pompoenblokjes", group overig):
      // the line it is now says what it is. A spoonful of paprikapoeder gives the paprika a few grams, no more
      let left = grams;
      for (const v of lines) {
        const share = Math.min(left, v.grams - (kept.get(v.index) ?? 0));
        give(v, share);
        left -= share;
      }
    } else {
      unweighed.push({ raw, name: line?.name ?? raw.name });
    }
  });
  // What the recipe had but did not weigh: a spoonful of something with the same name is a spice, not the vegetable
  for (const { raw, name } of unweighed) {
    const unit = normalizeUnit(raw.unit).unit;
    if (['tl', 'el', 'snufje'].includes(unit)) continue;
    const was = parseAmount(raw.amount);
    for (const v of linesOfIt(raw.name, name)) {
      const is = parseAmount(v.raw.amount);
      const counted = was !== null && is !== null && is > 0 && normalizeUnit(v.raw.unit).unit === unit;
      give(v, counted ? v.grams * Math.min(1, was / is) : v.grams);
    }
  }
  const unmatched = now.filter((v) => !kept.has(v.index));
  const unmatchedTotal = unmatched.reduce((sum, v) => sum + v.grams, 0);
  for (const v of unmatched) if (renamed > 0) kept.set(v.index, renamed * (v.grams / unmatchedTotal));
  return now.map(({ line, index, grams }) => ({
    line, index, grams,
    own: Math.min(grams, kept.get(index) ?? 0),
    salad: isSaladVegetable(line.name) && !isCookedIn(line.name, steps),
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
 * what gives way. `freed` is the room (grams, whole recipe) that less pasta
 * or rice leaves on the plates: the ceiling goes up by it.
 */
export function topUpRoom(parts: TopUpPart[], wet: boolean, servings: number, floor: number, freed = 0): TopUpRoom {
  const sum = (pick: (p: TopUpPart) => number) => parts.reduce((total, p) => total + pick(p), 0);
  const own = sum((p) => p.own);
  const salad = sum((p) => (p.salad ? p.grams - p.own : 0));
  const cooked = sum((p) => (p.salad ? 0 : p.grams - p.own));
  const saladRoom = Math.min(salad, Math.max(SIDE_SALAD * servings, floor * servings - own - cooked));
  const added = salad + cooked;
  const fits = saladRoom + cooked;
  const addedRoom = wet ? fits : Math.min(fits, Math.max(TOP_UP_CEILING * servings + freed - own, floor * servings - own, 0));
  return { wet, salad, saladRoom, added, addedRoom };
}

/**
 * What is too much about a top-up, in words a model can act on; empty when it
 * fits. `floor` is the vegetable aim per serving the top-up is after, `freed`
 * the room it made by cooking less pasta or rice.
 */
export function topUpObjections(parts: TopUpPart[], wet: boolean, servings: number, floor: number, freed = 0): string[] {
  const room = topUpRoom(parts, wet, servings, floor, freed);
  const per = (grams: number) => Math.round(grams / servings);
  const objections: string[] = [];
  // A little over is not worth another round
  if (room.salad > room.saladRoom * 1.1) {
    objections.push(`${per(room.salad)} g salade of rauwkost per portie erbij; ernaast past een gewone salade van hooguit ${per(room.saladRoom)} g`);
  }
  const total = parts.reduce((sum, p) => sum + p.grams, 0);
  if (!wet && room.saladRoom + (room.added - room.salad) > room.addedRoom * 1.05) {
    objections.push(`${per(total)} g groente per portie, boven de ${TOP_UP_CEILING + per(freed)} g: bij een gerecht zonder soep of saus krijgt het gezin dat niet op`);
  }
  return objections;
}
