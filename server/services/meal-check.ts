import type Database from 'better-sqlite3';
import { Line, linesOf, recipeLines, weigh } from './vegetables.js';

/**
 * Whether a dinner is a whole meal: enough carbohydrate and protein besides
 * its vegetables. A rough estimate from the structured ingredients (grams per
 * serving times a typical share), only meant to flag what is clearly missing,
 * like a green salad without bread or a pesto pasta without protein.
 */

/** Below these, per serving, the meal needs something added (or is a side dish). */
export const CARBS_MINIMUM = 30;
export const PROTEIN_MINIMUM = 15;

export type MealPart = 'koolhydraten' | 'eiwit';

export interface MealCheck {
  carbs_per_serving: number;
  protein_per_serving: number;
  /** What a dinner still lacks; empty when it is a whole meal. */
  missing: MealPart[];
}

// Pasta shapes and noodles, shared by both tables below
const PASTA = 'pasta|spaghetti|penne|fusilli|farfalle|macaroni|linguine|tagliatelle|taglierini|tagliolini|fettuccine|pappardelle'
  + '|bucatini|orecchiette|lasagne|rigatoni|tortellini|ravioli|conchiglie|schelpjes|paccheri|ditalini|capellini|gemelli'
  + '|casarecce|trofie|ziti|orzo|risoni|vermicelli|noedel|noodle|udon|soba|\\bmie\\b';
// An egg by any of its names, but not "prei"
const EGG = /\bei\b|eieren|scharrelei|eidooier/;
// Meat and fish by name, for those filed elsewhere (frozen, "overig") or counted in pieces and jars
const MEAT_OR_FISH = /zalm|tonijn|kabeljauw|makreel|garnal|pangasius|koolvis|witvis|visfilet|\bvis\b|forel|mossel|kibbeling|lekkerbek|\bkip|kalkoen|gehakt|\brund|varken|\bham\b|\bspek|worst|chorizo|\blam/;
// Ready-cooked grains (pouches like "super grains"), as opposed to dry ones
const COOKED_GRAINS = /gekookte granen|grains/;

// Grams of carbohydrate per 100 g, by what the ingredient is (first match wins)
const CARBS: Array<[RegExp, number]> = [
  [/zoete aardappel/, 20],
  [/aardappel|krieltje|friet/, 15],
  [/gnocchi/, 32],
  [/kastanje(?!champignon)/, 35],
  [/bladerdeeg|pizzadeeg|pizzabodem/, 40],
  [/filo/, 55],
  [/poppadom/, 50],
  [COOKED_GRAINS, 30],
  [/brood|focaccia|ciabatta|baguette|flatbread|tortilla(?!chip)|wrap|pita|pitta|naan|\bbol\b|hamburgerbol|bolletje|broodje|croissant/, 45],
  [/tortillachip|cracker/, 60],
  [/rijstvel/, 80],
  [/bloem\b|tarwebloem/, 70],
  [new RegExp(`${PASTA}|rijst|couscous|bulgur|quinoa|granen|graanmix|gort|freekeh|polenta|meel|semolina|griesmeel|havermout`), 65],
];
// Product groups a carbohydrate source can come from (not "currypasta" in sauzen, not "rijstazijn")
const CARB_GROUPS = new Set(['droogwaren', 'brood', 'groenten', 'diepvries', 'overig']);
const NOT_CARB = /azijn|paneermeel|broodkruim|bouillon/;

// Grams of protein per 100 g; meat and fish go by their product group
const PROTEIN: Array<[RegExp, number]> = [
  [EGG, 12.5],
  [/ricotta|cottage|kwark|skyr/, 10],
  [/griekse yoghurt/, 9],
  [/yoghurt/, 4],
  [/feta/, 14],
  [/kaas|parmezaan|pecorino|mozzarella|halloumi|paneer|cheddar|gorgonzola|gruy[eè]re|emmentaler/, 22],
  [/edamame/, 11],
  [/gnocchi/, 4],
  [/tofu/, 12],
  [/tempeh/, 19],
  [/seitan/, 25],
  [/vegetarisch gehakt|vegaburger|vegaballetje/, 15],
  // Meat and fish filed elsewhere (frozen, "overig"), recognised by name; fish sticks are half breading
  [/visstick/, 13],
  [MEAT_OR_FISH, 20],
  [/falafel/, 13],
  [/hummus/, 7],
  [/pindakaas|pinda|noten|amandel|walnoot|walnoten|cashew|pistache|hazelnoot|pecan|pitten|zaden|zaad|tahin/, 20],
  [/melk(?!chocola)/, 3.5],
  // Grains, bread and peas carry protein too: a plate of pasta brings ~10 g
  [/quinoa/, 14],
  [COOKED_GRAINS, 5],
  [new RegExp(`${PASTA}|couscous|bulgur|granen|graanmix|gort|freekeh|meel|semolina|griesmeel|bloem\\b|havermout`), 12],
  [/rijst/, 8],
  [/brood|flatbread|tortilla(?!chip)|wrap|pita|pitta|naan|bolletje|broodje|hamburgerbol|pizzadeeg|pizzabodem/, 9],
  [/doperwt|erwt(?!en uit)|erwtjes/, 5],
];
const PROTEIN_GROUPS = new Set(['vlees', 'vis']);
// Pulses, per 100 g: cooked (tinned or jarred) about 7 g protein and 13 g
// carbohydrate, dry 21-24 g protein and 50 g carbohydrate
// Daal from a pouch is cooked lentils
const PULSES = /bonen|boon\b|kikkererwt|linze|spliterwt|daal\b|dahl\b/;
const GREEN_BEANS = /sperzie|slabo|snijbo|tuinbo|haricot/;

function pulse(line: Line, name: string): { protein: number; carbs: number } | undefined {
  if (!PULSES.test(name) || GREEN_BEANS.test(name)) return undefined;
  if (/blik|pot|daal|dahl/.test(name) || ['blik', 'pot'].includes(line.unit)) return { protein: 7, carbs: 13 };
  return { protein: /linze|spliterwt/.test(name) ? 24 : 21, carbs: 50 };
}

// Typical grams of things counted in pieces or slices, which the vegetable weights do not cover
const PIECE_GRAMS: Array<[RegExp, number]> = [
  [EGG, 55],
  [/focaccia/, 400],
  [/pizzadeeg|pizzabodem/, 200],
  [/ciabatta|baguette/, 250],
  [/rijstvel/, 10],
  [/lasagne/, 17],
  [/stokbrood/, 250],
  [/naan/, 90],
  [/pita|pitta|flatbread|hamburgerbol|\bbol\b|bolletje|broodje/, 70],
  [/tortilla|wrap/, 60],
  [/brood/, 35],
  [/bladerdeeg/, 75],
  [/kippendij/, 100],
  [/visstick/, 30],
  [/filo/, 25],
  [/poppadom/, 12],
];

function gramsOf(line: Line): number | null {
  const weighed = weigh(line);
  if (weighed !== null) return weighed;
  const name = line.name.toLowerCase();
  // A typical weight for anything counted rather than measured (stuks, plak, snee, bodem…)
  // A pouch of ready-cooked grains
  if (line.unit === 'zak' && COOKED_GRAINS.test(name)) return line.amount * 250;
  const counted = !['g', 'ml', 'el', 'tl', 'snufje', 'blik', 'pot', 'zak', 'bos'].includes(line.unit);
  const piece = PIECE_GRAMS.find(([re]) => re.test(name))?.[1];
  if (piece !== undefined && counted) return line.amount * piece;
  // Meat and fish in pieces (fillets, chops) or slices
  const animal = PROTEIN_GROUPS.has(line.group) || MEAT_OR_FISH.test(name);
  if (animal && line.unit === 'stuks') return line.amount * 125;
  if (animal && line.unit === 'plak') return line.amount * 15;
  // A jar of tuna or the like, drained
  if (animal && line.unit === 'pot') return line.amount * 150;
  return null;
}

function share(name: string, table: Array<[RegExp, number]>): number | undefined {
  return table.find(([re]) => re.test(name))?.[1];
}

/** Carbohydrate and protein per serving of these lines, and what a dinner would lack. */
export function checkLines(lines: Line[], servings: number): MealCheck {
  let carbs = 0;
  let protein = 0;
  for (const line of lines) {
    const name = line.name.toLowerCase();
    const g = gramsOf(line);
    if (g === null) continue;
    const legume = pulse(line, name);
    const carbShare = legume?.carbs
      ?? (CARB_GROUPS.has(line.group) && !NOT_CARB.test(name) ? share(name, CARBS) : undefined);
    if (carbShare) carbs += (g * carbShare) / 100;
    const proteinShare = PROTEIN_GROUPS.has(line.group) ? 20
      : legume?.protein ?? (NOT_CARB.test(name) ? undefined : share(name, PROTEIN));
    if (proteinShare) protein += (g * proteinShare) / 100;
  }
  const per = (total: number) => Math.round(total / Math.max(1, servings));
  const result: MealCheck = { carbs_per_serving: per(carbs), protein_per_serving: per(protein), missing: [] };
  if (result.carbs_per_serving < CARBS_MINIMUM) result.missing.push('koolhydraten');
  if (result.protein_per_serving < PROTEIN_MINIMUM) result.missing.push('eiwit');
  return result;
}

/** The check for every recipe in the library (or for `ids`), by recipe id. */
export function mealChecks(db: Database.Database, ids?: number[]): Map<number, MealCheck> {
  const result = new Map<number, MealCheck>();
  for (const [id, { servings, lines }] of recipeLines(db, ids)) result.set(id, checkLines(lines, servings));
  return result;
}

/** The check for ingredients that are not saved yet, such as a proposed change. */
export function mealCheckOf(
  db: Database.Database,
  ingredients: Array<{ name: string; amount: number | string | null; unit: string; product_group: string }>,
  servings: number,
): MealCheck {
  return checkLines(linesOf(db, ingredients), servings);
}
