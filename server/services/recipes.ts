import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  convertToBase,
  loadAliases,
  findIngredient,
  loadAliasesByCanonical,
  loadConversions,
  normalizeIngredient,
  syncRecipeIngredients,
} from './ingredients.js';
import { looksLikeSameIngredient } from './ingredient-admin.js';
import { regenerateActiveMenus } from './shopping-generator.js';
import { storedRecipeName } from './recipe-name.js';

export const RECIPE_STATUSES = ['concept', 'goedgekeurd', 'archief'] as const;
export type RecipeStatus = typeof RECIPE_STATUSES[number];

export class RecipeError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message);
  }
}

const IngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  amount: z.union([z.number(), z.string().max(30), z.null()]),
  unit: z.string().max(30).default(''),
  product_group: z.string().max(30).default('overig'),
  note: z.string().max(200).nullish(),
});

const NutritionSchema = z.object({
  calories: z.number(),
  protein_g: z.number(),
  fiber_g: z.number(),
  iron_mg: z.number(),
});

/** A recipe as sent by the editor (import review or edit). */
export const RecipeInputSchema = z.object({
  name: z.string().trim().min(1, 'Naam is verplicht').max(200).transform(storedRecipeName),
  status: z.enum(RECIPE_STATUSES).default('concept'),
  servings: z.number().int().min(1).max(50).default(4),
  meal_type: z.string().trim().max(30).nullish(),
  prep_time_minutes: z.number().int().min(0).max(1440).nullish(),
  cost_index: z.string().max(5).nullish(),
  ingredients: z.array(IngredientInputSchema).min(1, 'Minstens één ingrediënt').max(60),
  steps: z.array(z.string().trim().min(1).max(2000)).max(40).default([]),
  tip: z.string().trim().max(1000).nullish(),
  nutrition_per_serving: NutritionSchema.nullish(),
  // Normalized here for every path (import, JSON bulk, editor): a long file name is cut, not refused
  source: z.string().trim().transform((s) => s.slice(0, 50)).optional(),
});

export type RecipeInput = z.infer<typeof RecipeInputSchema>;

/** Validate editor input; zod messages become one readable error. */
export function parseRecipeInput(body: unknown): RecipeInput {
  const result = RecipeInputSchema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RecipeError(`${issue.path.join('.') || 'recept'}: ${issue.message}`);
  }
  return result.data;
}

/** The recipe_data JSON shape shared with menu imports and the recipe view. */
function toRecipeData(input: RecipeInput) {
  return {
    servings: input.servings,
    ingredients: input.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount,
      unit: i.unit,
      product_group: i.product_group,
      ...(i.note ? { note: i.note } : {}),
    })),
    steps: input.steps,
    ...(input.nutrition_per_serving ? { nutrition_per_serving: input.nutrition_per_serving } : {}),
    ...(input.tip ? { tip: input.tip } : {}),
  };
}

/**
 * Insert a new recipe or update an existing one, then resync its ingredient
 * rows. An update also refreshes the snapshot on menu days that are still to
 * come, so the day's recipe shows what the shopping list is computed from;
 * days already eaten keep the version that was cooked.
 */
export function saveRecipe(db: Database.Database, input: RecipeInput, id?: number): number {
  const clash = db.prepare('SELECT name FROM recipes WHERE recipe_key(name) = recipe_key(?) AND id IS NOT ?')
    .get(input.name, id ?? null) as { name: string } | undefined;
  if (clash) throw new RecipeError(`Er is al een recept "${clash.name}"`, 409);

  const data = JSON.stringify(toRecipeData(input));
  const meta = [input.status, input.meal_type ?? null, input.prep_time_minutes ?? null, input.cost_index ?? null];

  return db.transaction(() => {
    let recipeId = id;
    if (recipeId === undefined) {
      recipeId = db.prepare(`
        INSERT INTO recipes (name, source, recipe_data, tags, status, meal_type, prep_time_minutes, cost_index)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.name, input.source ?? 'import', data, JSON.stringify(input.meal_type ? [input.meal_type] : []), ...meta)
        .lastInsertRowid as number;
    } else {
      const result = db.prepare(`
        UPDATE recipes SET name = ?, recipe_data = ?, status = ?, meal_type = ?, prep_time_minutes = ?, cost_index = ?
        WHERE id = ?
      `).run(input.name, data, ...meta, recipeId);
      if (result.changes === 0) throw new RecipeError('Recept niet gevonden', 404);
      // The library is the source of truth, so a field cleared there is cleared here too
      db.prepare(`
        UPDATE menu_days SET recipe_name = ?, recipe_data = ?, meal_type = ?, prep_time_minutes = ?, cost_index = ?
        WHERE recipe_id = ? AND status != 'completed'
      `).run(input.name, data, ...meta.slice(1), recipeId);
    }
    syncRecipeIngredients(db, recipeId, input.ingredients, input.servings);
    return recipeId;
  })();
}

/** Save changes to a recipe and recompute the shopping lists that use it. */
export function updateRecipe(db: Database.Database, input: RecipeInput, id: number): void {
  saveRecipe(db, input, id);
  regenerateActiveMenus([id]);
}

export function setRecipeStatus(db: Database.Database, id: number, status: unknown): void {
  if (!RECIPE_STATUSES.includes(status as RecipeStatus)) {
    throw new RecipeError(`Status moet een van ${RECIPE_STATUSES.join(', ')} zijn`);
  }
  const result = db.prepare('UPDATE recipes SET status = ? WHERE id = ?').run(status, id);
  if (result.changes === 0) throw new RecipeError('Recept niet gevonden', 404);
}

const RATINGS_SQL = `
  SELECT md.recipe_id,
         SUM(df.rating = 'lekker') AS lekker,
         SUM(df.rating = 'ok') AS ok,
         SUM(df.rating = 'minder') AS minder
  FROM day_feedback df
  JOIN menu_days md ON md.id = df.day_id
  WHERE md.recipe_id IS NOT NULL
  GROUP BY md.recipe_id
`;

export function listRecipes(db: Database.Database, filter: { status?: string; search?: string }) {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.status) {
    where.push('r.status = ?');
    params.push(filter.status);
  }
  if (filter.search) {
    where.push('r.name LIKE ?');
    params.push(`%${filter.search}%`);
  }

  return db.prepare(`
    SELECT r.*, COALESCE(f.lekker, 0) AS rating_lekker, COALESCE(f.ok, 0) AS rating_ok,
           COALESCE(f.minder, 0) AS rating_minder
    FROM recipes r
    LEFT JOIN (${RATINGS_SQL}) f ON f.recipe_id = r.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY r.times_used DESC, r.name
  `).all(...params);
}

export function countRecipesByStatus(db: Database.Database): Record<string, number> {
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM recipes GROUP BY status').all() as Array<{ status: string; c: number }>;
  return Object.fromEntries(RECIPE_STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.c ?? 0]));
}

export function getRecipe(db: Database.Database, id: number) {
  const recipe = db.prepare(`
    SELECT r.*, COALESCE(f.lekker, 0) AS rating_lekker, COALESCE(f.ok, 0) AS rating_ok,
           COALESCE(f.minder, 0) AS rating_minder
    FROM recipes r
    LEFT JOIN (${RATINGS_SQL}) f ON f.recipe_id = r.id
    WHERE r.id = ?
  `).get(id);
  if (!recipe) throw new RecipeError('Recept niet gevonden', 404);
  return recipe;
}

export interface IngredientPreview {
  /** Name as it will be stored and shopped. */
  canonical: string;
  ingredient_id: number | null;
  /** existing: known ingredient; alias: name resolves to another; new: will be created. */
  match: 'existing' | 'alias' | 'new';
  amount: number | null;
  unit: string;
  /** Whether this amount adds up with the ingredient's other uses on the shopping list. */
  adds_up: boolean;
  base_unit: string | null;
  /** For a new ingredient: an existing one it probably is ("kokosmelk" for "kokosmelk uit blik"). */
  suggestion: string | null;
}

/** Show how each ingredient line will land in the library, without saving anything. */
export function previewIngredients(db: Database.Database, ingredients: unknown): IngredientPreview[] {
  // Lenient on purpose: the editor previews rows while they are being typed
  const parsed = z.array(z.object({
    name: z.string().max(100),
    amount: z.union([z.number(), z.string().max(30), z.null()]).optional(),
    unit: z.string().max(30).optional(),
    product_group: z.string().max(30).optional(),
  })).max(60).safeParse(ingredients);
  if (!parsed.success) throw new RecipeError('Ongeldige ingrediëntenlijst');

  const aliases = loadAliases(db);
  const conversions = loadConversions(db);
  const aliasesOf = loadAliasesByCanonical(db);
  const knownNames = (db.prepare('SELECT name FROM ingredients ORDER BY name').all() as Array<{ name: string }>).map((r) => r.name);

  return parsed.data.map((raw) => {
    const norm = normalizeIngredient({
      name: raw.name,
      amount: raw.amount ?? null,
      unit: raw.unit ?? '',
      product_group: raw.product_group ?? 'overig',
    }, aliases);
    const existing = norm.name ? findIngredient(db, norm.name) : undefined;
    const cleanedInput = raw.name.toLowerCase().replace(/\s+/g, ' ').trim();

    let addsUp = true;
    if (existing && norm.amount !== null) {
      addsUp = convertToBase(norm.amount, norm.unit, existing.unit, conversions.get(existing.id), {
        variant: norm.variant,
        name: existing.name,
        aliases: aliasesOf.get(existing.name),
      }) !== null;
    }

    return {
      canonical: existing?.name ?? norm.name,
      ingredient_id: existing?.id ?? null,
      match: !existing ? 'new' : existing.name === cleanedInput ? 'existing' : 'alias',
      amount: norm.amount,
      unit: norm.unit,
      adds_up: addsUp,
      base_unit: existing?.unit ?? null,
      suggestion: !existing && norm.name ? knownNames.find((known) => looksLikeSameIngredient(norm.name, known)) ?? null : null,
    };
  });
}
