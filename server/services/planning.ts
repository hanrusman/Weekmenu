import type Database from 'better-sqlite3';
import { VEGETABLE_TARGET } from './vegetables.js';
import { assessRecipes } from './recipes.js';
import type { ProteinTag } from '../../shared/menu-rules.js';

// Recognised by name as well, since the product group says where it is shopped
// ("diepvries garnalen" sits in diepvries), not what it is
const FISH = /(^|\s)(\w*zalm\w*|garna\w*|tonijn\w*|kabeljauw\w*|makreel\w*|haring\w*|pangasius\w*|koolvis\w*|witvis\w*|sardine\w*|mossel\w*|lekkerbek\w*|vissticks?|visfilet\w*|forel\w*|ansjovis\w*|schol\w*|schelvis\w*)(\s|$)/;
// A vegetarian substitute is neither meat nor fish, whatever it imitates
const SUBSTITUTE = /vega|vegetari|plantaardig|vleesvervang|quorn|seitan/;
const MEAT = /(^|\s)(kip\w*|gehakt|rund\w*|varken\w*|spek\w*|ham|worst|rookworst|lam\w*|kalkoen\w*|biefstuk|schnitzel\w*|shoarma|chorizo|salami|bacon)(\s|$)/;
// Pulses as the Voedingscentrum counts them; green beans and peas are vegetables.
// Singular and plural, since imports are asked for singular names ("witte boon").
const LEGUMES = /linze|kikkererwt|spliterwt|edamame|sojabo{1,2}n|tofu|tempeh|falafel|hummus|(^|\s)(bruine|witte|zwarte|rode|kidney|borlotti|cannellini|pinto)\s?(bonen|boon)/;

interface ApprovedRecipe {
  id: number;
  name: string;
  meal_type: string | null;
  prep_time_minutes: number | null;
  cost_index: string | null;
  last_used: string | null;
  veg_exception: number;
  rating_count: number;
  rating_avg: number | null;
}

/** An average number of stars the Dutch way: "4,5", "4". */
export function formatStars(avg: number): string {
  return String(Math.round(avg * 10) / 10).replace('.', ',');
}

/** The fish, meat and pulses in a recipe, from its structured ingredients; none for a vegetarian dinner. */
export function proteinTags(ingredients: Array<{ name: string; product_group: string }>): ProteinTag[] {
  const main = ingredients.filter((i) => !i.name.includes('bouillon'));
  const animal = main.filter((i) => !SUBSTITUTE.test(i.name));
  const tags: ProteinTag[] = [];
  if (animal.some((i) => i.product_group === 'vis' || FISH.test(i.name))) tags.push('vis');
  if (animal.some((i) => i.product_group === 'vlees' || MEAT.test(i.name))) tags.push('vlees');
  if (main.some((i) => LEGUMES.test(i.name))) tags.push('peulvruchten');
  return tags;
}

/** "vis", "vlees", "peulvruchten" (combined with +) or "vega". */
export function proteinOf(ingredients: Array<{ name: string; product_group: string }>): string {
  const tags = proteinTags(ingredients);
  return tags.length ? tags.join(' + ') : 'vega';
}

/** The family's latest remarks on dinners, newest week first. */
export function familyNotes(db: Database.Database, limit = 15): Array<{ recipe_name: string; stars: number; notes: string }> {
  return db.prepare(`
    SELECT md.recipe_name, df.stars, df.notes
    FROM day_feedback df JOIN menu_days md ON md.id = df.day_id JOIN menus m ON m.id = md.menu_id
    WHERE df.notes IS NOT NULL AND trim(df.notes) != ''
    ORDER BY m.year DESC, m.week_number DESC, md.day_of_week
    LIMIT ?
  `).all(limit) as Array<{ recipe_name: string; stars: number; notes: string }>;
}

/** How many breakfasts and snacks a week has, next to the dinners. */
export const BREAKFASTS_PER_WEEK = 2;
export const SNACKS_PER_WEEK = 2;

const FORMAT = `## Gevraagd formaat

Lever het menu als pure JSON (geen markdown, geen uitleg eromheen). Kies per dag bij voorkeur een recept uit de lijst hierboven en verwijs ernaar met het nummer, net zo voor ontbijt en tussendoortjes:

{
  "days": [
    {"day_name": "Donderdag", "recipe_id": 12, "recipe_name": "Linzensoep"},
    {"day_name": "Vrijdag", "recipe_id": 7, "recipe_name": "Zalm uit de oven met krieltjes"}
  ],
  "breakfasts": [
    {"recipe_id": 31, "recipe_name": "Overnight oats met appel", "day_name": "Zaterdag"},
    {"recipe_id": 32, "recipe_name": "Volkoren pannenkoeken", "day_name": "Zondag"}
  ],
  "snacks": [
    {"recipe_id": 41, "recipe_name": "Energy balls met dadel"},
    {"recipe_id": 42, "recipe_name": "Hummus met groentesticks"}
  ]
}

- recipe_id: het #nummer uit de lijst; recipe_name: de naam precies zoals in de lijst (de app controleert of die bij het nummer hoort).
- day_name bij ontbijt en tussendoortjes is optioneel: noem een dag als het ergens bij hoort (zoals een weekendontbijt), anders maak je het een dag naar keuze.
- Een nieuw recept mag ook, maar schrijf het dan volledig uit; het komt als concept in de bibliotheek:
  {"day_name": "Zaterdag", "recipe_name": "…", "meal_type": "pasta|rijst|wrap|oven|salade|soep|stamppot|vrij",
   "prep_time_minutes": 30, "cost_index": "€|€€|€€€",
   "recipe": {"servings": 4,
     "ingredients": [{"name": "ui", "amount": 2, "unit": "stuks", "product_group": "groenten"}],
     "steps": ["…"], "nutrition_per_serving": {"calories": 450, "protein_g": 25, "fiber_g": 8, "iron_mg": 3}}}
  Ingrediënten: naam in enkelvoud, amount een getal (of null bij "naar smaak"), unit alleen g, ml, el, tl, stuks, teen, blik, pot, zak, bos, plak, snufje, takje, krop of bakje.
- Een nieuw ontbijt of tussendoortje mag ook, volledig uitgeschreven zoals hierboven maar zonder meal_type en cost_index; het komt als concept in de bibliotheek. Een tussendoortje wordt in zijn geheel gemaakt: servings is wat één keer maken oplevert (bijvoorbeeld 12 energy balls).
- Een boodschappenlijst is niet nodig: de app rekent die zelf uit de recepten.`;

/**
 * The breakfasts or snacks Claude can choose from: approved first, then the
 * concepts, which the family only gets to judge by having them once. With too
 * few, Claude is asked to write out new ones.
 */
function extrasSection(db: Database.Database, course: 'ontbijt' | 'snack', title: string, intro: string): string[] {
  const recipes = db.prepare(`
    SELECT id, name, status, prep_time_minutes, last_used FROM recipes
    WHERE course = ? AND status IN ('goedgekeurd', 'concept')
    ORDER BY status = 'concept', name
  `).all(course) as Array<{ id: number; name: string; status: string; prep_time_minutes: number | null; last_used: string | null }>;
  const ingredientsOf = db.prepare(`
    SELECT i.name FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = ? AND i.product_group NOT IN ('kruiden', 'olie') ORDER BY ri.id LIMIT 8
  `);
  const perWeek = course === 'ontbijt' ? BREAKFASTS_PER_WEEK : SNACKS_PER_WEEK;

  const lines = ['', title, '', intro];
  if (recipes.length < perWeek) {
    lines.push(`De bibliotheek heeft er ${recipes.length === 0 ? 'nog geen' : `maar ${recipes.length}`}: vul aan met een nieuw recept, volledig uitgeschreven.`);
  }
  let heading = '';
  for (const r of recipes) {
    const group = r.status === 'goedgekeurd' ? 'Goedgekeurd:' : 'Nog niet geprobeerd (concept):';
    if (group !== heading) {
      heading = group;
      lines.push('', group);
    }
    const meta = [
      r.prep_time_minutes ? `${r.prep_time_minutes} min` : null,
      r.last_used ? `laatst gepland ${r.last_used}` : null,
    ].filter(Boolean).join(' · ');
    lines.push(`#${r.id} ${r.name}${meta ? ` — ${meta}` : ''}`);
    const main = (ingredientsOf.all(r.id) as Array<{ name: string }>).map((i) => i.name);
    if (main.length) lines.push(`   ${main.join(', ')}`);
  }
  return lines;
}

/** "mist koolhydraten", "mist koolhydraten en eiwit", or nothing for a whole meal. */
function missingNote(missing: string[]): string | null {
  return missing.length ? `mist ${missing.join(' en ')}` : null;
}

/**
 * Everything Claude needs to plan next week from the library, as text to
 * paste into a conversation: the approved recipes, what was planned lately,
 * recent feedback, and the JSON format the menu import expects.
 */
export function buildPlanningBrief(db: Database.Database, today: Date = new Date()): { text: string; recipe_count: number } {
  const recipes = db.prepare(`
    SELECT r.id, r.name, r.meal_type, r.prep_time_minutes, r.cost_index, r.last_used, r.veg_exception,
           COUNT(df.stars) AS rating_count,
           ROUND(AVG(df.stars), 1) AS rating_avg
    FROM recipes r
    LEFT JOIN menu_days md ON md.recipe_id = r.id
    LEFT JOIN day_feedback df ON df.day_id = md.id
    WHERE r.status = 'goedgekeurd' AND r.course = 'hoofdgerecht'
    GROUP BY r.id
    ORDER BY r.meal_type, r.name
  `).all() as ApprovedRecipe[];

  const ingredientsOf = db.prepare(`
    SELECT i.name, i.product_group FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = ? ORDER BY ri.id
  `);

  const assessments = assessRecipes(db, recipes.map((r) => r.id));

  const lines: string[] = [
    `# Weekmenu-bibliotheek (${today.toISOString().slice(0, 10)})`,
    '',
    'Plan het weekmenu met deze recepten: het gezin heeft ze goedgekeurd. Let op variatie ten opzichte van wat '
      + 'recent gepland is, op de feedback, en op de voedingsrichtlijnen (vis, peulvruchten, vlees per week).',
    '',
    `Groente: het gezin wil elke avond ${VEGETABLE_TARGET} g groente per volwassene; "g groente" staat per recept, per persoon. `
      + 'Een recept met "uitzondering" (zoals pizza) haalt dat niet en mag hooguit één keer per week, met het bijgerecht uit het recept.',
    '',
    'Volledige maaltijd: een recept met "mist koolhydraten" of "mist eiwit" is zo geen hele maaltijd. '
      + 'Kies liever een ander, of noem in de naam wat erbij komt (bijvoorbeeld "met stokbrood").',
    '',
    `## Goedgekeurde recepten (${recipes.length})`,
    '',
  ];

  if (recipes.length === 0) {
    lines.push('(Nog geen goedgekeurde recepten: stel een volledig nieuw menu voor.)');
  }
  for (const r of recipes) {
    const ingredients = ingredientsOf.all(r.id) as Array<{ name: string; product_group: string }>;
    const meta = [
      r.meal_type,
      r.prep_time_minutes ? `${r.prep_time_minutes} min` : null,
      r.cost_index,
      proteinOf(ingredients),
      `${assessments.get(r.id)?.veg.per_serving ?? 0} g groente${r.veg_exception ? ' (uitzondering)' : ''}`,
      missingNote(assessments.get(r.id)?.meal.missing ?? []),
      r.rating_count ? `beoordeeld ${formatStars(r.rating_avg!)} van 5 sterren (${r.rating_count}×)` : null,
      r.last_used ? `laatst gepland ${r.last_used}` : null,
    ].filter(Boolean).join(' · ');
    lines.push(`#${r.id} ${r.name} — ${meta}`);
    const main = ingredients
      .filter((i) => !['kruiden', 'olie'].includes(i.product_group))
      .map((i) => i.name)
      .slice(0, 10);
    if (main.length) lines.push(`   ${main.join(', ')}`);
  }

  // The week's dinners by day, then its breakfasts and snacks
  const recent = db.prepare(`
    SELECT week_number, label, recipe_name FROM (
      SELECT m.year, m.week_number, 0 AS extra, md.day_of_week AS pos, md.day_name AS label, md.recipe_name
      FROM menu_days md JOIN menus m ON m.id = md.menu_id
      WHERE m.id IN (SELECT id FROM menus ORDER BY year DESC, week_number DESC LIMIT 3)
      UNION ALL
      SELECT m.year, m.week_number, 1, (me.kind = 'snack') * 100 + me.position,
             CASE me.kind WHEN 'ontbijt' THEN 'Ontbijt' ELSE 'Tussendoortje' END, r.name
      FROM menu_extras me JOIN menus m ON m.id = me.menu_id JOIN recipes r ON r.id = me.recipe_id
      WHERE m.id IN (SELECT id FROM menus ORDER BY year DESC, week_number DESC LIMIT 3)
    )
    ORDER BY year DESC, week_number DESC, extra, pos
  `).all() as Array<{ week_number: number; label: string; recipe_name: string }>;
  if (recent.length) {
    lines.push('', '## Recent gepland (liever niet herhalen)', '');
    let week = '';
    for (const d of recent) {
      const label = `Week ${d.week_number}`;
      if (label !== week) {
        week = label;
        lines.push(`${label}:`);
      }
      lines.push(`- ${d.label}: ${d.recipe_name}`);
    }
  }

  const feedback = familyNotes(db);
  if (feedback.length) {
    lines.push('', '## Opmerkingen van het gezin', '');
    for (const f of feedback) lines.push(`- ${f.recipe_name} (${f.stars}/5): "${f.notes.trim()}"`);
  }

  lines.push(...extrasSection(db, 'ontbijt', `## Ontbijt (${BREAKFASTS_PER_WEEK} per week)`,
    `Kies ${BREAKFASTS_PER_WEEK} ontbijten voor de dagen dat er tijd voor is, zoals het weekend.`));
  lines.push(...extrasSection(db, 'snack', `## Gezonde tussendoortjes (${SNACKS_PER_WEEK} per week)`,
    `Kies ${SNACKS_PER_WEEK} gezonde tussendoortjes: liefst met fruit, groente, noten, zuivel of volkoren, en weinig toegevoegde suiker.`));

  lines.push('', FORMAT);
  return { text: lines.join('\n'), recipe_count: recipes.length };
}
