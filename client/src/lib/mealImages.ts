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
  { filename: 'cacio-e-pepe.png', keywords: ['cacio e pepe', 'cacio', 'pecorino'], mealTypes: ['pasta'] },
  { filename: 'pasta-all-arrabbiata.png', keywords: ['arrabbiata', 'arrabiata', 'all\'arrabbiata'], mealTypes: ['pasta'] },
  { filename: 'pasta-alla-norma.png', keywords: ['alla norma', 'norma', 'aubergine pasta'], mealTypes: ['pasta'] },

  // --- RIJST ---
  { filename: 'biryani.png', keywords: ['biryani', 'biriyani'] },
  { filename: 'nasi-goreng.png', keywords: ['nasi', 'nasi goreng'] },
  { filename: 'fried-rice-met-ei-en-groenten.png', keywords: ['gebakken rijst', 'fried rice', 'egg fried rice'] },
  { filename: 'paella-met-zeevruchten.png', keywords: ['paella', 'zeevruchten', 'spaanse rijst'] },
  { filename: 'risotto-bianco.png', keywords: ['risotto'] },
  { filename: 'rendang.png', keywords: ['rendang', 'indonesisch'] },

  // --- CURRY ---
  { filename: 'curry-butter-chicken.png', keywords: ['butter chicken', 'murgh makhani'] },
  { filename: 'curry-chicken-tikka-masala.png', keywords: ['tikka masala', 'chicken tikka'] },
  { filename: 'groene-curry-met-kip.png', keywords: ['groene curry', 'green curry'] },
  { filename: 'japanse-curry.png', keywords: ['japanse curry', 'katsu curry'] },
  { filename: 'chana-masala.png', keywords: ['chana masala', 'kikkererwten curry'] },
  { filename: 'aloo-gobi.png', keywords: ['aloo gobi', 'aloo', 'gobi', 'bloemkool aardappel curry'] },

  // --- WRAP / TORTILLA ---
  { filename: 'falafel.png', keywords: ['falafel'], mealTypes: ['wrap'] },
  { filename: 'turkse-pizza.png', keywords: ['turkse pizza', 'lahmacun'] },
  { filename: 'pide-met-gehakt.png', keywords: ['pide', 'turkse pide'] },

  // --- OVEN / STOOFSCHOTEL ---
  { filename: 'moussaka.png', keywords: ['moussaka', 'mousaka'] },
  { filename: 'quiche-lorraine.png', keywords: ['quiche', 'quiche lorraine', 'hartige taart'] },
  { filename: 'shakshuka.png', keywords: ['shakshuka', 'shakshouka'] },
  { filename: 'shepherds-pie.png', keywords: ['shepherd', 'shepherds pie', 'cottage pie'] },
  { filename: 'pulled-pork-uit-de-oven.png', keywords: ['pulled pork'] },
  { filename: 'geroosterde-kip-met-citroen-en-kruiden.png', keywords: ['geroosterde kip', 'kip citroen', 'hele kip'] },
  { filename: 'pizza-margherita.png', keywords: ['pizza', 'margherita'] },
  { filename: 'focaccia.png', keywords: ['focaccia'] },
  { filename: 'ratatouille.png', keywords: ['ratatouille'] },
  { filename: 'boeuf-bourguignon.png', keywords: ['boeuf bourguignon', 'bourguignon', 'runderstoofpot'] },
  { filename: 'ossobuco.png', keywords: ['ossobuco', 'osso buco'] },
  { filename: 'imam-bayildi.png', keywords: ['imam bayildi', 'imam bayıldı', 'gevulde aubergine'] },
  { filename: 'tajine-met-kip-en-citroen.png', keywords: ['tajine', 'tagine'] },
  { filename: 'bloemkool-met-kaassaus.png', keywords: ['bloemkool', 'kaassaus'] },

  // --- SALADE ---
  { filename: 'caprese-salade.png', keywords: ['caprese', 'mozzarella tomaat'] },
  { filename: 'griekse-salade-met-feta.png', keywords: ['griekse salade', 'griekse', 'feta salade'] },
  { filename: 'nicoise-salad.png', keywords: ['niçoise', 'nicoise', 'tonijn salade'] },
  { filename: 'waldorfsalade.png', keywords: ['waldorf', 'waldorfsalade'] },
  { filename: 'tabbouleh.png', keywords: ['tabbouleh', 'tabouleh'] },
  { filename: 'poke-bowl.png', keywords: ['poke bowl', 'pokébowl', 'poké'] },

  // --- COUSCOUS ---
  { filename: 'couscous-met-geroosterde-groenten.png', keywords: ['couscous groenten', 'geroosterde groenten couscous'] },
  { filename: 'couscous-royale.png', keywords: ['couscous royale', 'couscous'] },

  // --- SOEP ---
  { filename: 'linzensoep.png', keywords: ['linzensoep', 'linzen soep'] },
  { filename: 'tomatensoep-zelfgemaakt.png', keywords: ['tomatensoep', 'tomaten soep'] },
  { filename: 'pompoensoep.png', keywords: ['pompoensoep', 'pompoen soep', 'butternut'] },
  { filename: 'erwtensoep.png', keywords: ['erwtensoep', 'snert'] },
  { filename: 'broccolisoep.png', keywords: ['broccolisoep', 'broccoli soep'] },
  { filename: 'gazpacho.png', keywords: ['gazpacho'] },
  { filename: 'bouillabaisse.png', keywords: ['bouillabaisse', 'vissoep'] },
  { filename: 'marokkaanse-harira.png', keywords: ['harira', 'marokkaanse soep'] },
  { filename: 'ribollita.png', keywords: ['ribollita', 'toscaanse soep'] },
  { filename: 'miso-soep.png', keywords: ['miso', 'misosoep', 'miso soep'] },
  { filename: 'tom-kha-gai.png', keywords: ['tom kha', 'tom kha gai', 'kokossoep'] },
  { filename: 'wonton-soep.png', keywords: ['wonton', 'wontonsoep'] },
  { filename: 'kimchi-jjigae.png', keywords: ['kimchi', 'jjigae', 'kimchi soep'] },

  // --- AZIATISCH ---
  { filename: 'pad-thai.png', keywords: ['pad thai', 'thaise noedels'] },
  { filename: 'bami-goreng.png', keywords: ['bami', 'bami goreng', 'noedels'] },
  { filename: 'bibimbap.png', keywords: ['bibimbap'] },
  { filename: 'bulgogi.png', keywords: ['bulgogi'] },
  { filename: 'bao-buns-met-buikspek.png', keywords: ['bao bun', 'bao', 'bao buns', 'buikspek'] },
  { filename: 'dan-dan-noodles.png', keywords: ['dan dan', 'dandan noodles'] },
  { filename: 'japanse-gyoza.png', keywords: ['gyoza', 'japanse gyoza', 'dumplings'] },
  { filename: 'okonomiyaki.png', keywords: ['okonomiyaki', 'japanse pannenkoek'] },
  { filename: 'gado-gado.png', keywords: ['gado gado', 'gado-gado'] },
  { filename: 'sate-met-pindasaus.png', keywords: ['saté', 'sate', 'sateh', 'pindasaus'] },
  { filename: 'teriyaki-zalm.png', keywords: ['teriyaki'] },

  // --- VLEES ---
  { filename: 'beef-joint-met-groenten.png', keywords: ['beef joint', 'rundvlees groenten', 'rosbief'] },
  { filename: 'beef-stroganoff.png', keywords: ['stroganoff', 'beef stroganoff'] },
  { filename: 'chili-con-carne.png', keywords: ['chili con carne', 'chili'] },
  { filename: 'kofte.png', keywords: ['köfte', 'kofte', 'kofta'] },
  { filename: 'spare-ribs.png', keywords: ['spare rib', 'spareribs'] },
  { filename: 'hamburger-zelfgemaakt.png', keywords: ['hamburger', 'burger'] },
  { filename: 'vitello-tonnato.png', keywords: ['vitello tonnato', 'vitello'] },

  // --- VIS / ZEEVRUCHTEN ---
  { filename: 'zalm-en-croute.png', keywords: ['zalm en croûte', 'zalm en croute', 'zalm', 'zalmfilet'] },
  { filename: 'fish-chips.png', keywords: ['fish and chips', 'fish chips', 'kibbeling'] },
  { filename: 'garnalen-in-knoflookboter.png', keywords: ['garnalen', 'knoflookboter', 'gambas'] },
  { filename: 'mosselen-in-witte-wijn.png', keywords: ['mosselen', 'moules', 'witte wijn'] },
  { filename: 'ceviche.png', keywords: ['ceviche'] },
  { filename: 'fritto-misto.png', keywords: ['fritto misto', 'gefrituurde vis'] },

  // --- AARDAPPEL ---
  { filename: 'aardappeltortilla-tortilla-espanola.png', keywords: ['tortilla', 'tortilla española', 'spaanse tortilla', 'aardappeltortilla'] },
  { filename: 'patatas-bravas.png', keywords: ['patatas bravas', 'patatas'] },

  // --- DIPS / BIJGERECHT ---
  { filename: 'hummus-zelfgemaakt.png', keywords: ['hummus'] },
  { filename: 'tzatziki.png', keywords: ['tzatziki'] },
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
