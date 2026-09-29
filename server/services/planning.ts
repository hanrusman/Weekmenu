import type Database from 'better-sqlite3';

// Recognised by name as well, since the product group says where it is shopped
// ("diepvries garnalen" sits in diepvries), not what it is
const FISH = /(^|\s)(\w*zalm\w*|garna\w*|tonijn\w*|kabeljauw\w*|makreel\w*|haring\w*|pangasius\w*|koolvis\w*|witvis\w*|sardine\w*|mossel\w*|lekkerbek\w*|vissticks?|visfilet\w*|forel\w*|ansjovis\w*|schol\w*|schelvis\w*)(\s|$)/;
const MEAT = /(^|\s)(kip\w*|gehakt|rund\w*|varken\w*|spek\w*|ham|worst|rookworst|lam\w*|kalkoen\w*|biefstuk|schnitzel\w*|shoarma|chorizo|salami|bacon)(\s|$)/;
// Pulses as the Voedingscentrum counts them; green beans and peas are vegetables
const LEGUMES = /linzen|kikkererwt|spliterwt|edamame|sojabon|tofu|tempeh|falafel|hummus|(^|\s)(bruine|witte|zwarte|rode|kidney|borlotti|cannellini|pinto)\s?bonen/;

interface ApprovedRecipe {
  id: number;
  name: string;
  meal_type: string | null;
  prep_time_minutes: number | null;
  cost_index: string | null;
  last_used: string | null;
  lekker: number;
  ok: number;
  minder: number;
}

/** "vis", "vlees", "peulvruchten" (combined with +) or "vega", from the recipe's structured ingredients. */
export function proteinOf(ingredients: Array<{ name: string; product_group: string }>): string {
  const main = ingredients.filter((i) => !i.name.includes('bouillon'));
  const tags: string[] = [];
  if (main.some((i) => i.product_group === 'vis' || FISH.test(i.name))) tags.push('vis');
  if (main.some((i) => i.product_group === 'vlees' || MEAT.test(i.name))) tags.push('vlees');
  if (main.some((i) => LEGUMES.test(i.name))) tags.push('peulvruchten');
  return tags.length ? tags.join(' + ') : 'vega';
}

const FORMAT = `## Gevraagd formaat

Lever het menu als pure JSON (geen markdown, geen uitleg eromheen). Kies per dag bij voorkeur een recept uit de lijst hierboven en verwijs ernaar met het nummer:

{
  "days": [
    {"day_name": "Donderdag", "recipe_id": 12, "recipe_name": "Linzensoep"},
    {"day_name": "Vrijdag", "recipe_id": 7, "recipe_name": "Zalm uit de oven met krieltjes"}
  ],
  "snack_suggestions": ["Appel met pindakaas"]
}

- recipe_id: het #nummer uit de lijst; recipe_name: de naam precies zoals in de lijst (de app controleert of die bij het nummer hoort).
- Een nieuw recept mag ook, maar schrijf het dan volledig uit; het komt als concept in de bibliotheek:
  {"day_name": "Zaterdag", "recipe_name": "…", "meal_type": "pasta|rijst|wrap|oven|salade|soep|stamppot|vrij",
   "prep_time_minutes": 30, "cost_index": "€|€€|€€€",
   "recipe": {"servings": 4,
     "ingredients": [{"name": "ui", "amount": 2, "unit": "stuks", "product_group": "groenten"}],
     "steps": ["…"], "nutrition_per_serving": {"calories": 450, "protein_g": 25, "fiber_g": 8, "iron_mg": 3}}}
  Ingrediënten: naam in enkelvoud, amount een getal (of null bij "naar smaak"), unit alleen g, ml, el, tl, stuks, teen, blik, pot, zak, bos, plak, snufje, takje, krop of bakje.
- Een boodschappenlijst is niet nodig: de app rekent die zelf uit de recepten.`;

/**
 * Everything Claude needs to plan next week from the library, as text to
 * paste into a conversation: the approved recipes, what was planned lately,
 * recent feedback, and the JSON format the menu import expects.
 */
export function buildPlanningBrief(db: Database.Database, today: Date = new Date()): { text: string; recipe_count: number } {
  const recipes = db.prepare(`
    SELECT r.id, r.name, r.meal_type, r.prep_time_minutes, r.cost_index, r.last_used,
           COALESCE(SUM(df.rating = 'lekker'), 0) AS lekker,
           COALESCE(SUM(df.rating = 'ok'), 0) AS ok,
           COALESCE(SUM(df.rating = 'minder'), 0) AS minder
    FROM recipes r
    LEFT JOIN menu_days md ON md.recipe_id = r.id
    LEFT JOIN day_feedback df ON df.day_id = md.id
    WHERE r.status = 'goedgekeurd'
    GROUP BY r.id
    ORDER BY r.meal_type, r.name
  `).all() as ApprovedRecipe[];

  const ingredientsOf = db.prepare(`
    SELECT i.name, i.product_group FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = ? ORDER BY ri.id
  `);

  const lines: string[] = [
    `# Weekmenu-bibliotheek (${today.toISOString().slice(0, 10)})`,
    '',
    'Plan het weekmenu met deze recepten: het gezin heeft ze goedgekeurd. Let op variatie ten opzichte van wat '
      + 'recent gepland is, op de feedback, en op de voedingsrichtlijnen (vis, peulvruchten, vlees per week).',
    '',
    `## Goedgekeurde recepten (${recipes.length})`,
    '',
  ];

  if (recipes.length === 0) {
    lines.push('(Nog geen goedgekeurde recepten: stel een volledig nieuw menu voor.)');
  }
  for (const r of recipes) {
    const ingredients = ingredientsOf.all(r.id) as Array<{ name: string; product_group: string }>;
    const ratings = [
      r.lekker ? `${r.lekker}× lekker` : null,
      r.ok ? `${r.ok}× ok` : null,
      r.minder ? `${r.minder}× minder` : null,
    ].filter(Boolean);
    const meta = [
      r.meal_type,
      r.prep_time_minutes ? `${r.prep_time_minutes} min` : null,
      r.cost_index,
      proteinOf(ingredients),
      ratings.length ? `beoordeeld ${ratings.join(', ')}` : null,
      r.last_used ? `laatst gepland ${r.last_used}` : null,
    ].filter(Boolean).join(' · ');
    lines.push(`#${r.id} ${r.name} — ${meta}`);
    const main = ingredients
      .filter((i) => !['kruiden', 'olie'].includes(i.product_group))
      .map((i) => i.name)
      .slice(0, 10);
    if (main.length) lines.push(`   ${main.join(', ')}`);
  }

  const recent = db.prepare(`
    SELECT m.week_number, m.year, md.day_name, md.recipe_name
    FROM menu_days md JOIN menus m ON m.id = md.menu_id
    WHERE m.id IN (SELECT id FROM menus ORDER BY year DESC, week_number DESC LIMIT 3)
    ORDER BY m.year DESC, m.week_number DESC, md.day_of_week
  `).all() as Array<{ week_number: number; year: number; day_name: string; recipe_name: string }>;
  if (recent.length) {
    lines.push('', '## Recent gepland (liever niet herhalen)', '');
    let week = '';
    for (const d of recent) {
      const label = `Week ${d.week_number}`;
      if (label !== week) {
        week = label;
        lines.push(`${label}:`);
      }
      lines.push(`- ${d.day_name}: ${d.recipe_name}`);
    }
  }

  const feedback = db.prepare(`
    SELECT md.recipe_name, df.rating, df.notes
    FROM day_feedback df JOIN menu_days md ON md.id = df.day_id JOIN menus m ON m.id = md.menu_id
    WHERE df.notes IS NOT NULL AND trim(df.notes) != ''
    ORDER BY m.year DESC, m.week_number DESC, md.day_of_week
    LIMIT 15
  `).all() as Array<{ recipe_name: string; rating: string; notes: string }>;
  if (feedback.length) {
    lines.push('', '## Opmerkingen van het gezin', '');
    for (const f of feedback) lines.push(`- ${f.recipe_name} (${f.rating}): "${f.notes.trim()}"`);
  }

  lines.push('', FORMAT);
  return { text: lines.join('\n'), recipe_count: recipes.length };
}
