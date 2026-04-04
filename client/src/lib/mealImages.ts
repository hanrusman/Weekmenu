/**
 * Meal Image Registry
 *
 * Images live in /icons/meals/ (client/public/icons/meals/).
 * Each entry has a filename and keywords that match recipe names.
 * Keywords are matched against the recipe name (case-insensitive).
 *
 * To add a new image:
 *   1. Drop the .png file in client/public/icons/meals/
 *   2. Add an entry below with its filename + relevant Dutch keywords
 *
 * Matching scores: 10 pts per keyword hit, 5 pts for meal_type match.
 * Highest scoring image wins; falls back to null (emoji used instead).
 */

export interface MealImageEntry {
  filename: string;
  keywords: string[];
  mealTypes?: string[]; // optional: restrict to these meal_type values
}

export const MEAL_IMAGES: MealImageEntry[] = [
  // --- PASTA ---
  { filename: 'pasta-bolognese.png', keywords: ['bolognese', 'gehakt', 'ragu'], mealTypes: ['pasta'] },
  { filename: 'pasta-carbonara.png', keywords: ['carbonara', 'spek', 'guanciale', 'ei'], mealTypes: ['pasta'] },
  { filename: 'pasta-pesto.png', keywords: ['pesto', 'basilicum', 'pijnboompit'], mealTypes: ['pasta'] },
  { filename: 'pasta-arrabiata.png', keywords: ['arrabiata', 'arrabbiata', 'tomatensaus', 'pittig'], mealTypes: ['pasta'] },
  { filename: 'pasta-zalm.png', keywords: ['zalm', 'roomkaas', 'dille'], mealTypes: ['pasta'] },
  { filename: 'pasta-courgette.png', keywords: ['courgette', 'zucchini'], mealTypes: ['pasta'] },
  { filename: 'pasta-spinazie.png', keywords: ['spinazie', 'ricotta', 'pijnboom'], mealTypes: ['pasta'] },
  { filename: 'pasta-kip.png', keywords: ['kipfilet', 'kipstoofpot', 'chicken pasta'], mealTypes: ['pasta'] },
  { filename: 'pasta-tonijn.png', keywords: ['tonijn', 'kappertjes'], mealTypes: ['pasta'] },
  { filename: 'pasta-champignon.png', keywords: ['champignon', 'paddenstoel', 'funghi'], mealTypes: ['pasta'] },
  { filename: 'pasta-gorgonzola.png', keywords: ['gorgonzola', 'blauwschimmel', 'peer'], mealTypes: ['pasta'] },
  { filename: 'pasta-puttanesca.png', keywords: ['puttanesca', 'olijf', 'ansjovis'], mealTypes: ['pasta'] },
  { filename: 'lasagne.png', keywords: ['lasagne', 'lasagna', 'bechamel'], mealTypes: ['pasta', 'oven'] },
  { filename: 'gnocchi.png', keywords: ['gnocchi', 'aardappelknoedel'], mealTypes: ['pasta', 'oven'] },
  { filename: 'spaghetti.png', keywords: ['spaghetti'], mealTypes: ['pasta'] },
  { filename: 'tagliatelle.png', keywords: ['tagliatelle', 'linguine', 'fettuccine'], mealTypes: ['pasta'] },
  { filename: 'risotto.png', keywords: ['risotto'], mealTypes: ['pasta', 'rijst'] },
  { filename: 'risotto-paddenstoel.png', keywords: ['risotto', 'paddenstoel', 'champignon', 'porcini'], mealTypes: ['pasta', 'rijst'] },

  // --- RIJST ---
  { filename: 'nasi.png', keywords: ['nasi', 'nasi goreng', 'bami'], mealTypes: ['rijst'] },
  { filename: 'wokschotel.png', keywords: ['wok', 'roerbak', 'stir fry', 'stirfry'], mealTypes: ['rijst'] },
  { filename: 'curry-kip.png', keywords: ['kip curry', 'curry kip', 'tikka masala', 'butter chicken'], mealTypes: ['rijst'] },
  { filename: 'curry-rood.png', keywords: ['rode curry', 'red curry', 'thai curry', 'thaise curry'] },
  { filename: 'curry-groen.png', keywords: ['groene curry', 'green curry'] },
  { filename: 'curry-geel.png', keywords: ['gele curry', 'yellow curry', 'massaman'] },
  { filename: 'rijst-garnalen.png', keywords: ['garnalen', 'garnalenrisotto', 'garnalen rijst'] },
  { filename: 'rijst-groenten.png', keywords: ['groenten rijst', 'rijst groenten', 'groenterijst'] },
  { filename: 'dahl.png', keywords: ['dahl', 'dal', 'linzen curry', 'linzencurry', 'makhani'] },
  { filename: 'biryani.png', keywords: ['biryani', 'biriyani'] },
  { filename: 'rijst-kip.png', keywords: ['teriyaki', 'kip rijst', 'popcorn kip'] },
  { filename: 'paella.png', keywords: ['paella', 'spaanse rijst'] },
  { filename: 'gebakken-rijst.png', keywords: ['gebakken rijst', 'fried rice', 'egg fried'] },

  // --- WRAP / TORTILLA ---
  { filename: 'wrap-kip.png', keywords: ['kipwrap', 'kip wrap', 'chicken wrap', 'fajita kip'], mealTypes: ['wrap'] },
  { filename: 'wrap-falafel.png', keywords: ['falafel', 'kikkererwt wrap'], mealTypes: ['wrap'] },
  { filename: 'wrap-tonijn.png', keywords: ['tonijnwrap', 'tonijn wrap'], mealTypes: ['wrap'] },
  { filename: 'wrap-halloumi.png', keywords: ['halloumi', 'haloumi'], mealTypes: ['wrap'] },
  { filename: 'wrap-pulled-pork.png', keywords: ['pulled pork', 'varkensvlees wrap', 'carnitas'], mealTypes: ['wrap'] },
  { filename: 'burrito.png', keywords: ['burrito', 'enchilada', 'quesadilla', 'mexicaans'], mealTypes: ['wrap'] },
  { filename: 'taco.png', keywords: ['taco', 'nacho'], mealTypes: ['wrap'] },
  { filename: 'pita.png', keywords: ['pita', 'pitabroodje', 'souvlaki', 'gyros', 'shoarma'] },
  { filename: 'gyros.png', keywords: ['gyros', 'shoarma', 'doner', 'kebab'] },

  // --- OVEN ---
  { filename: 'ovenschotel.png', keywords: ['ovenschotel', 'oven schotel', 'ovenpasta'], mealTypes: ['oven'] },
  { filename: 'quiche.png', keywords: ['quiche', 'hartige taart'], mealTypes: ['oven'] },
  { filename: 'frittata.png', keywords: ['frittata', 'eierschotel', 'shakshuka', 'shakshouka'] },
  { filename: 'kip-oven.png', keywords: ['kipschotel', 'kip uit de oven', 'geroosterde kip', 'kip poot'], mealTypes: ['oven'] },
  { filename: 'moussaka.png', keywords: ['moussaka', 'aubergine schotel'] },
  { filename: 'stamppot-oven.png', keywords: ['gegratineerd', 'gratin'], mealTypes: ['oven'] },
  { filename: 'pizza.png', keywords: ['pizza', 'focaccia', 'flatbread'] },
  { filename: 'groentekoekjes.png', keywords: ['groentekoekjes', 'groenteballetjes', 'vegaburger', 'veggieburger'] },
  { filename: 'gehaktbal.png', keywords: ['gehaktbal', 'gehaktballetje', 'slavink'] },
  { filename: 'kip-pesto-oven.png', keywords: ['kip pesto', 'pesto kip'] },

  // --- SALADE ---
  { filename: 'caesar-salade.png', keywords: ['caesar', 'caesarsalade'], mealTypes: ['salade'] },
  { filename: 'griekse-salade.png', keywords: ['griekse', 'feta salade', 'griekenland'], mealTypes: ['salade'] },
  { filename: 'maaltijdsalade.png', keywords: ['maaltijdsalade', 'hoofdgerecht salade'], mealTypes: ['salade'] },
  { filename: 'quinoa-salade.png', keywords: ['quinoa', 'quinoasalade'], mealTypes: ['salade'] },
  { filename: 'niçoise.png', keywords: ['niçoise', 'nicoise', 'tonijn salade'] },
  { filename: 'couscous-salade.png', keywords: ['couscous', 'tabouleh', 'tabbouleh'] },
  { filename: 'buddha-bowl.png', keywords: ['buddha bowl', 'grain bowl', 'poke bowl', 'pokébowl'], mealTypes: ['salade'] },
  { filename: 'salade-kip.png', keywords: ['kip salade', 'gegrilde kip salade'] },

  // --- SOEP ---
  { filename: 'soep.png', keywords: ['soep', 'soup'] },
  { filename: 'linzensoep.png', keywords: ['linzensoep', 'linzen soep', 'lentil soup'] },
  { filename: 'tomatensoep.png', keywords: ['tomatensoep', 'tomatensoup', 'tomaten soep'] },
  { filename: 'minestrone.png', keywords: ['minestrone', 'italiaanse soep'] },
  { filename: 'pompoensoep.png', keywords: ['pompoensoep', 'pompoen soep', 'butternut'] },
  { filename: 'erwtensoep.png', keywords: ['erwtensoep', 'snertsoep', 'snert'] },
  { filename: 'ramen.png', keywords: ['ramen', 'miso soep', 'misosoep', 'japanse noedelsoep'] },
  { filename: 'pho.png', keywords: ['pho', 'vietnamese noedelsoep'] },

  // --- STAMPPOT / AARDAPPEL ---
  { filename: 'boerenkool.png', keywords: ['boerenkool', 'boerenkoolstamppot'] },
  { filename: 'hutspot.png', keywords: ['hutspot', 'wortel ui stamppot'] },
  { filename: 'andijvie.png', keywords: ['andijvie', 'andijviestamppot'] },
  { filename: 'stamppot.png', keywords: ['stamppot', 'aardappelstamppot'] },
  { filename: 'aardappelgratin.png', keywords: ['aardappelgratin', 'gegratineerde aardappel'] },

  // --- AZIATISCH ---
  { filename: 'pad-thai.png', keywords: ['pad thai', 'thaise noedels', 'thainoodles'] },
  { filename: 'bami.png', keywords: ['bami', 'bami goreng', 'noedels'] },
  { filename: 'sushi.png', keywords: ['sushi', 'maki', 'temaki'] },
  { filename: 'dim-sum.png', keywords: ['dim sum', 'dumplings', 'gyoza', 'wontons'] },
  { filename: 'kimchi-kom.png', keywords: ['kimchi', 'koreaans'] },
  { filename: 'dumplings.png', keywords: ['dumplings', 'gyoza'] },

  // --- VLEES / VIS ---
  { filename: 'vis.png', keywords: ['visvlees', 'vis schotel', 'gebakken vis'] },
  { filename: 'zalm.png', keywords: ['zalm', 'zalmfilet', 'gerookte zalm'] },
  { filename: 'kabeljauw.png', keywords: ['kabeljauw', 'witvis', 'tilapia', 'pangasius'] },
  { filename: 'garnalen-schotel.png', keywords: ['garnalen schotel', 'gambas', 'scampi'] },
  { filename: 'kip-groenten.png', keywords: ['kip groenten', 'kipstuk', 'kippendij'] },
  { filename: 'gehakt.png', keywords: ['gehakt', 'gehaktschotel'] },
  { filename: 'spare-ribs.png', keywords: ['spare rib', 'spareribs'] },

  // --- VEGETARISCH / VEGAN ---
  { filename: 'falafel.png', keywords: ['falafel'] },
  { filename: 'tofu.png', keywords: ['tofu', 'tempeh'] },
  { filename: 'vegaburger.png', keywords: ['vegaburger', 'veggieburger', 'plantburger'] },
  { filename: 'linzen.png', keywords: ['linzen', 'lentils'] },
  { filename: 'kikkererwten.png', keywords: ['kikkererwten', 'kikkererwt', 'hummus schotel', 'chickpea'] },
  { filename: 'groenteschotel.png', keywords: ['groenteschotel', 'gemengde groenten', 'ratatouille'] },

  // --- VRIJ / OVERIG ---
  { filename: 'pannenkoek.png', keywords: ['pannenkoek', 'pancake', 'crêpe'], mealTypes: ['vrij'] },
  { filename: 'sandwich.png', keywords: ['sandwich', 'broodje', 'tosti'] },
  { filename: 'hamburger.png', keywords: ['hamburger', 'burger'] },
  { filename: 'hotdog.png', keywords: ['hotdog', 'worstje'] },
  { filename: 'omelet.png', keywords: ['omelet', 'scrambled eggs', 'roerei'], mealTypes: ['vrij'] },
];

/**
 * Score a recipe against a meal image entry.
 * Returns 0 if the entry's mealTypes restriction excludes the current meal type.
 * Higher score = better match.
 */
function scoreMatch(recipeName: string, mealType: string, entry: MealImageEntry): number {
  // Hard filter: if the entry is restricted to certain meal types, skip non-matching ones
  if (entry.mealTypes && !entry.mealTypes.includes(mealType)) {
    return 0;
  }

  const nameLower = recipeName.toLowerCase();
  let score = 0;

  for (const kw of entry.keywords) {
    if (nameLower.includes(kw.toLowerCase())) {
      // Longer keyword matches are worth more (more specific)
      score += 5 + kw.length;
    }
  }

  return score;
}

/**
 * Find the best matching meal image for a recipe.
 * Returns the public URL path, or null if no match (use emoji fallback).
 */
export function findMealImage(recipeName: string, mealType: string): string | null {
  let bestScore = 0;
  let bestFile: string | null = null;

  for (const entry of MEAL_IMAGES) {
    const score = scoreMatch(recipeName, mealType, entry);
    if (score > bestScore) {
      bestScore = score;
      bestFile = entry.filename;
    }
  }

  // Require at least one keyword match (score > 0)
  return bestFile && bestScore > 0 ? `/icons/meals/${bestFile}` : null;
}
