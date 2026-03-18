import { getSystemPrompt } from '../prompts/system.js';
import { getCurrentSeason, getSeasonalVegetables } from '../prompts/seasonal.js';
import { callClaude } from './claude.js';
import { getDb } from '../db.js';
import { z } from 'zod';

const IngredientSchema = z.object({
  name: z.string(),
  amount: z.string(),
  unit: z.string(),
  product_group: z.string(),
});

const RecipeSchema = z.object({
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()),
  nutrition_per_serving: z.object({
    calories: z.number(),
    protein_g: z.number(),
    fiber_g: z.number(),
    iron_mg: z.number(),
  }),
  tip: z.string().optional(),
});

const DaySchema = z.object({
  day_name: z.string(),
  recipe_name: z.string(),
  meal_type: z.string(),
  prep_time_minutes: z.number(),
  cost_index: z.string(),
  recipe: RecipeSchema,
});

const MenuResponseSchema = z.object({
  days: z.array(DaySchema).length(6),
  shopping_list: z.array(z.object({
    product_group: z.string(),
    items: z.array(z.object({
      name: z.string(),
      quantity: z.string(),
      for_days: z.array(z.string()),
      is_perishable: z.boolean().optional(),
      storage_tip: z.string().optional(),
    })),
  })),
  snack_suggestions: z.array(z.string()),
});

export type MenuResponse = z.infer<typeof MenuResponseSchema>;
export type DayData = z.infer<typeof DaySchema>;

const DAY_NAMES = ['Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag'];

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export async function generateMenu(weekNumber?: number, year?: number, preferences?: string): Promise<number> {
  const now = new Date();
  const wk = weekNumber || getISOWeek(now);
  const yr = year || now.getFullYear();
  const season = getCurrentSeason();
  const vegs = getSeasonalVegetables(season);

  const systemPrompt = getSystemPrompt(season, vegs);

  // Get recent history
  const db = getDb();
  const recentMenus = db.prepare(`
    SELECT md.recipe_name, md.day_name FROM menu_days md
    JOIN menus m ON md.menu_id = m.id
    WHERE m.year = ? AND m.week_number >= ? AND m.week_number < ?
    ORDER BY m.week_number DESC
  `).all(yr, wk - 3, wk) as Array<{ recipe_name: string; day_name: string }>;

  let historyText = '';
  if (recentMenus.length > 0) {
    historyText = `\nDe afgelopen weken hebben we gegeten: ${recentMenus.map((r) => r.recipe_name).join(', ')}.
Vermijd herhaling van deze gerechten.`;
  }

  const userPrompt = `Genereer een weekmenu voor week ${wk}, ${yr}.
Seizoen: ${season}
Seizoensgroenten: ${vegs.join(', ')}
${historyText}
${preferences ? `Voorkeuren deze week: ${preferences}` : ''}

De dagen zijn: ${DAY_NAMES.join(', ')}
Elke dag een ander meal_type uit: pasta, rijst, wrap, oven, salade, vrij

Lever het menu als pure JSON (geen markdown, geen backticks) in dit formaat:
{
  "days": [
    {
      "day_name": "Woensdag",
      "recipe_name": "...",
      "meal_type": "pasta|rijst|wrap|oven|salade|vrij",
      "prep_time_minutes": 25,
      "cost_index": "€|€€|€€€",
      "recipe": {
        "ingredients": [
          {"name": "...", "amount": "300", "unit": "g", "product_group": "groenten"}
        ],
        "steps": ["Stap 1...", "Stap 2..."],
        "nutrition_per_serving": {
          "calories": 450,
          "protein_g": 25,
          "fiber_g": 8,
          "iron_mg": 3.2
        },
        "tip": "..."
      }
    }
  ],
  "shopping_list": [
    {
      "product_group": "groenten",
      "items": [
        {"name": "courgette", "quantity": "3 stuks", "for_days": ["Woensdag", "Vrijdag"], "is_perishable": true, "storage_tip": "In de koelkast"}
      ]
    }
  ],
  "snack_suggestions": ["Appel met pindakaas", "Komkommer met hummus"]
}`;

  const response = await callClaude(systemPrompt, userPrompt);

  // Parse JSON - strip any markdown fences if present
  let jsonStr = response.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = MenuResponseSchema.parse(JSON.parse(jsonStr));

  // Check for existing menu this week
  const existing = db.prepare('SELECT id FROM menus WHERE week_number = ? AND year = ?').get(wk, yr) as { id: number } | undefined;
  if (existing) {
    db.prepare('DELETE FROM menu_days WHERE menu_id = ?').run(existing.id);
    db.prepare('DELETE FROM shopping_items WHERE menu_id = ?').run(existing.id);
    db.prepare('DELETE FROM pantry_check WHERE menu_id = ?').run(existing.id);
    db.prepare('DELETE FROM menus WHERE id = ?').run(existing.id);
  }

  // Insert menu
  const result = db.prepare(
    'INSERT INTO menus (week_number, year, status, snack_suggestions) VALUES (?, ?, ?, ?)'
  ).run(wk, yr, 'draft', JSON.stringify(parsed.snack_suggestions));
  const menuId = result.lastInsertRowid as number;

  // Insert days
  const insertDay = db.prepare(`
    INSERT INTO menu_days (menu_id, day_of_week, day_name, recipe_name, recipe_data, meal_type, prep_time_minutes, cost_index, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'proposed')
  `);

  for (let i = 0; i < parsed.days.length; i++) {
    const day = parsed.days[i];
    insertDay.run(
      menuId,
      i,
      day.day_name,
      day.recipe_name,
      JSON.stringify(day.recipe),
      day.meal_type,
      day.prep_time_minutes,
      day.cost_index,
    );
  }

  // Insert shopping items
  const insertItem = db.prepare(`
    INSERT INTO shopping_items (menu_id, product_group, item_name, quantity, for_days, is_perishable, storage_tip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const group of parsed.shopping_list) {
    for (const item of group.items) {
      insertItem.run(
        menuId,
        group.product_group,
        item.name,
        item.quantity,
        JSON.stringify(item.for_days),
        item.is_perishable ? 1 : 0,
        item.storage_tip || null,
      );
    }
  }

  return menuId;
}

export async function regenerateDay(menuId: number, dayId: number): Promise<void> {
  const db = getDb();
  const season = getCurrentSeason();
  const vegs = getSeasonalVegetables(season);
  const systemPrompt = getSystemPrompt(season, vegs);

  // Get current menu context
  const otherDays = db.prepare(
    'SELECT day_name, recipe_name, meal_type FROM menu_days WHERE menu_id = ? AND id != ?'
  ).all(menuId, dayId) as Array<{ day_name: string; recipe_name: string; meal_type: string }>;

  const currentDay = db.prepare('SELECT * FROM menu_days WHERE id = ? AND menu_id = ?').get(dayId, menuId) as {
    id: number; day_name: string; meal_type: string;
  } | undefined;

  if (!currentDay) throw new Error('Dag niet gevonden');

  const usedTypes = otherDays.map((d) => d.meal_type);

  const userPrompt = `Genereer een alternatief gerecht voor ${currentDay.day_name}.

De andere dagen van het menu zijn:
${otherDays.map((d) => `- ${d.day_name}: ${d.recipe_name} (${d.meal_type})`).join('\n')}

Reeds gebruikte meal_types: ${usedTypes.join(', ')}
Kies een ANDER meal_type als het kan.

Lever pure JSON (geen markdown) in dit formaat:
{
  "day_name": "${currentDay.day_name}",
  "recipe_name": "...",
  "meal_type": "...",
  "prep_time_minutes": 25,
  "cost_index": "€€",
  "recipe": {
    "ingredients": [{"name": "...", "amount": "300", "unit": "g", "product_group": "groenten"}],
    "steps": ["Stap 1..."],
    "nutrition_per_serving": {"calories": 450, "protein_g": 25, "fiber_g": 8, "iron_mg": 3.2},
    "tip": "..."
  }
}`;

  const response = await callClaude(systemPrompt, userPrompt);
  let jsonStr = response.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = DaySchema.parse(JSON.parse(jsonStr));

  db.prepare(`
    UPDATE menu_days SET recipe_name = ?, recipe_data = ?, meal_type = ?, prep_time_minutes = ?, cost_index = ?, status = 'proposed'
    WHERE id = ? AND menu_id = ?
  `).run(
    parsed.recipe_name,
    JSON.stringify(parsed.recipe),
    parsed.meal_type,
    parsed.prep_time_minutes,
    parsed.cost_index,
    dayId,
    menuId,
  );
}
