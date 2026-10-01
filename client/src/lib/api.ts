const BASE = '/api';

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  const res = await fetch(`${BASE}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (res.status === 401) {
    onUnauthorized?.();
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const authApi = {
  login: (email: string, password: string) =>
    request<{ user: { id: number; email: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: { id: number; email: string } }>('/auth/me'),
};

export interface MenuDay {
  id: number;
  menu_id: number;
  day_of_week: number;
  day_name: string;
  date: string | null;
  recipe_name: string;
  recipe_data: string;
  meal_type: string;
  prep_time_minutes: number;
  cost_index: string;
  status: string;
  completed_at: string | null;
  notes: string | null;
  recipe_id?: number | null;
  /** Version of the library recipe's own picture, when it has one. */
  recipe_image_version?: number | null;
}

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

export function formatDayLabel(day: MenuDay): string {
  if (!day.date) return day.day_name;
  const [y, m, d] = day.date.split('-').map(Number);
  return `${day.day_name} ${d} ${MONTHS[m - 1]}`;
}

export interface Menu {
  id: number;
  week_number: number;
  year: number;
  status: string;
  created_at: string;
  shopping_list: string | null;
  snack_suggestions: string | null;
  days?: MenuDay[];
}

export interface ShoppingItem {
  id: number;
  menu_id: number;
  product_group: string;
  item_name: string;
  quantity: string;
  for_days: string;
  is_perishable: number;
  checked: number;
  storage_tip: string | null;
}

export interface PantryItem {
  id: number;
  menu_id: number;
  item_name: string;
  quantity: string | null;
  needed_for_days: string;
  should_have: number;
  have_it: number;
}

export type RecipeStatus = 'concept' | 'goedgekeurd' | 'archief';

export interface Recipe {
  id: number;
  name: string;
  source: string;
  recipe_data: string;
  tags: string;
  times_used: number;
  last_used: string | null;
  created_at: string;
  status: RecipeStatus;
  servings: number | null;
  meal_type: string | null;
  prep_time_minutes: number | null;
  cost_index: string | null;
  rating_lekker: number;
  rating_ok: number;
  rating_minder: number;
  /** Own picture: null until one is uploaded, then bumped on every new one. */
  image_version: number | null;
  /** Set while a new picture is asked for. */
  image_requested_at: string | null;
  /** Why the last attempt failed; cleared by asking again. */
  image_error: string | null;
  /** A dinner; cakes, desserts, bread and snacks are kept but not planned. */
  main_course: boolean;
  /** A dinner that cannot carry the full vegetable aim (pizza night): at most once a week. */
  veg_exception: boolean;
  /** Grams of vegetables per serving, from the ingredients. */
  veg_per_serving: number;
  /** Vegetable lines that could not be weighed, so are not in the count. */
  veg_unweighed: string[];
  /** The latest automatic vegetable top-up (single recipe only), which can be undone. */
  veg_revision?: { veg_before: number; veg_after: number; summary: string | null; created_at: string } | null;
}

export type VegetableOutcome = 'boosted' | 'not_main' | 'enough' | 'failed' | 'stale' | 'reverted';

export interface VegetableJob {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  total: number;
  done: number;
  counts: Record<'boosted' | 'not_main' | 'enough' | 'failed' | 'stale', number>;
  current: string[];
  error: string | null;
}

export interface VegetableOverview {
  configured: boolean;
  target: number;
  minimum: number;
  counts: { dinners: number; below: number; to_do: number; not_main: number };
  job: VegetableJob;
  results: Array<{
    id: number; name: string; outcome: VegetableOutcome; note: string | null;
    before: number | null; after: number | null; now: number;
  }>;
}

export interface RecipeIngredient {
  name: string;
  amount: string | number | null;
  unit: string;
  product_group: string;
  note?: string | null;
}

export interface Nutrition {
  calories: number;
  protein_g: number;
  fiber_g: number;
  iron_mg: number;
}

export interface RecipeData {
  servings?: number;
  ingredients: RecipeIngredient[];
  steps: string[];
  /** Absent for imported recipes without an estimate. */
  nutrition_per_serving?: Nutrition | null;
  tip?: string | null;
}

/** What the recipe editor sends and the parser returns. */
export interface RecipeInput {
  name: string;
  status?: RecipeStatus;
  servings: number;
  meal_type: string | null;
  prep_time_minutes: number | null;
  cost_index?: string | null;
  ingredients: RecipeIngredient[];
  steps: string[];
  tip: string | null;
  nutrition_per_serving: Nutrition | null;
  main_course?: boolean;
  veg_exception?: boolean;
}

export interface IngredientPreview {
  canonical: string;
  ingredient_id: number | null;
  match: 'existing' | 'alias' | 'new';
  amount: number | null;
  unit: string;
  adds_up: boolean;
  base_unit: string | null;
  suggestion: string | null;
}

export interface Feedback {
  id: number;
  day_id: number;
  rating: 'lekker' | 'ok' | 'minder';
  notes: string | null;
  created_at: string;
}

export interface FeedbackExport {
  text: string;
  feedback: Array<{
    week_number: number;
    year: number;
    day_name: string;
    recipe_name: string;
    meal_type: string;
    rating: string;
    notes: string | null;
  }>;
}

// Menu API
export const api = {
  getMenus: () => request<Menu[]>('/menus'),
  getActiveMenu: () => request<(Menu & { days: MenuDay[] }) | null>('/menus/active'),
  getMenu: (id: number) => request<Menu & { days: MenuDay[] }>(`/menus/${id}`),
  getTargetWeek: () => request<{ weekNumber: number; year: number }>('/menus/target-week'),
  importMenu: (data: { menu: unknown; weekNumber?: number; year?: number }) =>
    request<Menu & { days: MenuDay[] }>('/menus/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteMenu: (id: number) =>
    request<{ ok: boolean }>(`/menus/${id}`, { method: 'DELETE' }),
  deleteDay: (menuId: number, dayId: number) =>
    request<{ ok: boolean }>(`/menus/${menuId}/days/${dayId}`, { method: 'DELETE' }),
  completeDay: (menuId: number, dayId: number) =>
    request<MenuDay>(`/menus/${menuId}/days/${dayId}/complete`, { method: 'PATCH' }),

  // Feedback
  saveFeedback: (menuId: number, dayId: number, rating: string, notes?: string) =>
    request<Feedback>(`/menus/${menuId}/days/${dayId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ rating, notes }),
    }),
  getDayFeedback: (menuId: number, dayId: number) =>
    request<Feedback | null>(`/menus/${menuId}/days/${dayId}/feedback`),
  exportFeedback: () => request<FeedbackExport>('/menus/feedback/export'),
  getPlanningBrief: () => request<{ text: string; recipe_count: number }>('/menus/planning-brief'),

  // Active menus list
  getActiveMenus: () => request<Menu[]>('/menus/active-list'),

  // Shopping per menu
  getShopping: (menuId: number) =>
    request<{ items: ShoppingItem[]; grouped: Record<string, ShoppingItem[]> }>(`/menus/${menuId}/shopping`),
  toggleShoppingItem: (menuId: number, itemId: number, checked: boolean) =>
    request<ShoppingItem>(`/menus/${menuId}/shopping/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ checked }),
    }),
  clearShopping: (menuId: number) =>
    request<{ ok: boolean }>(`/menus/${menuId}/shopping`, { method: 'DELETE' }),
  regenerateShopping: (menuId: number) =>
    request<{ items: ShoppingItem[]; grouped: Record<string, ShoppingItem[]> }>(
      `/menus/${menuId}/shopping/regenerate`, { method: 'POST' }),

  // Pantry per menu
  getPantry: (menuId: number) => request<PantryItem[]>(`/menus/${menuId}/pantry`),
  togglePantryItem: (menuId: number, itemId: number, have_it: boolean) =>
    request<PantryItem>(`/menus/${menuId}/pantry/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ have_it }),
    }),

  // Recipes
  getRecipes: (filter: { status?: RecipeStatus; search?: string } = {}) => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.search) params.set('search', filter.search);
    const query = params.toString();
    return request<{ recipes: Recipe[]; counts: Record<RecipeStatus, number> }>(`/recipes${query ? `?${query}` : ''}`);
  },
  getRecipe: (id: number) => request<Recipe>(`/recipes/${id}`),
  createRecipe: (recipe: RecipeInput) =>
    request<Recipe>('/recipes', { method: 'POST', body: JSON.stringify(recipe) }),
  updateRecipe: (id: number, recipe: RecipeInput) =>
    request<Recipe>(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(recipe) }),
  setRecipeStatus: (id: number, status: RecipeStatus) =>
    request<Recipe>(`/recipes/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  requestRecipeImage: (id: number) =>
    request<Recipe>(`/recipes/${id}/image-request`, { method: 'POST' }),
  getParserStatus: () => request<{ configured: boolean }>('/recipes/parser'),
  parseRecipe: (text: string) =>
    request<{ draft: RecipeInput; preview: IngredientPreview[] }>('/recipes/parse', {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),
  splitRecipes: (text: string) =>
    request<{ candidates: Array<{ title: string; text: string; existing: { id: number; name: string } | null }> }>(
      '/recipes/split', { method: 'POST', body: JSON.stringify({ text }) }),
  importRecipeText: (text: string, title: string, source: string) =>
    request<Recipe>('/recipes/import-text', { method: 'POST', body: JSON.stringify({ text, title, source }) }),
  getBulkFormat: () => request<{ text: string }>('/recipes/bulk-format'),
  revertVegetables: (id: number) => request<Recipe>(`/recipes/${id}/vegetables/revert`, { method: 'POST' }),

  // Vegetable top-up
  getVegetables: () => request<VegetableOverview>('/vegetables'),
  runVegetables: (ids?: number[]) =>
    request<{ job: VegetableJob }>('/vegetables/run', { method: 'POST', body: JSON.stringify(ids ? { ids } : {}) }),
  previewIngredients: (ingredients: RecipeIngredient[]) =>
    request<IngredientPreview[]>('/recipes/preview-ingredients', {
      method: 'POST',
      body: JSON.stringify({ ingredients }),
    }),

  // Ingredients
  getIngredients: () => request<Ingredient[]>('/ingredients'),
  updateIngredient: (id: number, data: { name?: string; unit?: string; product_group?: string }) =>
    request<{ conversions_reset: boolean }>(`/ingredients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  mergeIngredient: (id: number, into: number) =>
    request<{ ok: boolean }>(`/ingredients/${id}/merge`, {
      method: 'POST',
      body: JSON.stringify({ into }),
    }),
  setConversion: (id: number, unit: string, factor: number) =>
    request<{ ok: boolean }>(`/ingredients/${id}/conversions`, {
      method: 'PUT',
      body: JSON.stringify({ unit, factor }),
    }),
  deleteConversion: (id: number, unit: string) =>
    request<{ ok: boolean }>(`/ingredients/${id}/conversions/${encodeURIComponent(unit)}`, { method: 'DELETE' }),

  // Single day (avoids N+1)
  getDay: (dayId: number) => request<MenuDay>(`/days/${dayId}`),
};

export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  product_group: string;
  recipe_count: number;
  /** factor: 1 of this unit = factor x the ingredient's unit; null = unknown */
  units_used: Array<{ unit: string; count: number; factor: number | null; builtin?: boolean; standard?: boolean }>;
  aliases: string[];
  needs_attention: boolean;
  merge_suggestions: number[];
}

export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}
