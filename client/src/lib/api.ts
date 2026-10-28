import type { Course, MealPart } from './courses';
import type { AhStatus, AhSuggestion, AhCountedProduct, AhAttempt, AhLine, AhAddResult } from '../../../shared/albert-heijn';
import type { PlannerState, ProposalJob, ProposalRequest } from '../../../shared/menu-planner';
const BASE = '/api';

export const ahApi = {
  status: () => request<AhStatus>('/albert-heijn/status'),
  connect: (code: string) => request<AhStatus>('/albert-heijn/connect', { method: 'POST', body: JSON.stringify({ code }) }),
  logout: () => request<AhStatus>('/albert-heijn/logout', { method: 'POST' }),
  suggestions: (menuId: number) => request<{ items: AhSuggestion[]; unfinished: AhAttempt[] }>(`/albert-heijn/menus/${menuId}/suggestions`),
  search: (item: number, q: string) => request<AhCountedProduct[]>(`/albert-heijn/search?item=${item}&q=${encodeURIComponent(q)}`),
  unfinished: () => request<AhAttempt[]>('/albert-heijn/unfinished'),
  add: (menuId: number, requestId: string, lines: AhLine[]) => request<AhAddResult>(`/albert-heijn/menus/${menuId}/cart`, {
    method: 'POST', body: JSON.stringify({ request_id: requestId, lines }),
  }),
  settle: (attempt: AhAttempt, action: 'finish' | 'abandon') => request<AhAddResult>(
    `/albert-heijn/menus/${attempt.menu_id}/cart/${attempt.request_id}/${action}`, { method: 'POST' }),
};

/** Planning a week in the app: the library with its facts, and a model's proposal. */
export const plannerApi = {
  get: (week?: number, year?: number) =>
    request<PlannerState>(`/planner${week && year ? `?week=${week}&year=${year}` : ''}`),
  propose: (body: ProposalRequest) =>
    request<{ job: ProposalJob }>('/planner/propose', { method: 'POST', body: JSON.stringify(body) }),
  proposal: () => request<{ job: ProposalJob }>('/planner/proposal'),
};

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
  /** On the rolling calendar: the week number of the day's menu, and its rating. */
  week_number?: number;
  stars?: number | null;
}

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

const SHORT_DAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];
const SHORT_MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** "di 13 okt", from the date; the day name alone when there is none. */
export function formatShortDay(day: { date: string | null; day_name: string }): string {
  if (!day.date) return day.day_name;
  const [y, m, d] = day.date.split('-').map(Number);
  return `${SHORT_DAYS[new Date(y, m - 1, d).getDay()]} ${d} ${SHORT_MONTHS[m - 1]}`;
}

/** Today as YYYY-MM-DD in local time. */
export function todayStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** "13–19 okt" or "29 sep – 5 okt": short, for tight spots like the week switcher. */
export function formatShortRange(first: string | null | undefined, last: string | null | undefined): string {
  if (!first || !last) return '';
  const [, m1, d1] = first.split('-').map(Number);
  const [, m2, d2] = last.split('-').map(Number);
  if (m1 === m2) return `${d1}–${d2} ${SHORT_MONTHS[m1 - 1]}`;
  return `${d1} ${SHORT_MONTHS[m1 - 1]} – ${d2} ${SHORT_MONTHS[m2 - 1]}`;
}

export function formatDayLabel(day: MenuDay): string {
  if (!day.date) return day.day_name;
  const [y, m, d] = day.date.split('-').map(Number);
  return `${day.day_name} ${d} ${MONTHS[m - 1]}`;
}

/** One of the week's breakfasts or snacks, read from its library recipe. */
export interface MenuExtra {
  id: number;
  menu_id: number;
  kind: 'ontbijt' | 'snack';
  /** Only when it belongs to a day, like a weekend breakfast. */
  day_name: string | null;
  date: string | null;
  recipe_id: number;
  recipe_name: string;
  meal_type: string | null;
  prep_time_minutes: number | null;
  recipe_image_version: number | null;
}

export interface Menu {
  id: number;
  week_number: number;
  year: number;
  status: string;
  created_at: string;
  shopping_list: string | null;
  snack_suggestions: string | null;
  archived_at?: string | null;
  /** On the rolling calendar: the day to cook tonight (today's, or an uneaten earlier one). */
  tonight_id?: number | null;
  /** In menu lists: the span of the days and how many were cooked. */
  first_date?: string | null;
  last_date?: string | null;
  day_count?: number;
  completed_count?: number;
  days?: MenuDay[];
  extras?: MenuExtra[];
}

export interface ArchivedDay {
  id: number;
  menu_id: number;
  day_name: string;
  date: string | null;
  recipe_id: number | null;
  recipe_name: string;
  meal_type: string;
  status: string;
  recipe_image_version: number | null;
  stars: number | null;
}

export interface ArchivedMenu {
  id: number;
  week_number: number;
  year: number;
  archived_at: string | null;
  first_date: string | null;
  last_date: string | null;
  days: ArchivedDay[];
}

/** "8–14 oktober" or "29 september – 5 oktober" for a span of YYYY-MM-DD dates. */
export function formatDateRange(first: string | null | undefined, last: string | null | undefined): string {
  if (!first || !last) return '';
  const [, m1, d1] = first.split('-').map(Number);
  const [, m2, d2] = last.split('-').map(Number);
  if (m1 === m2) return d1 === d2 ? `${d1} ${MONTHS[m1 - 1]}` : `${d1}–${d2} ${MONTHS[m1 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
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
  /** How often it was rated, and the average of 1–5 stars (null when never). */
  rating_count: number;
  rating_avg: number | null;
  /** Own picture: null until one is uploaded, then bumped on every new one. */
  image_version: number | null;
  /** Set while a new picture is asked for. */
  image_requested_at: string | null;
  /** Why the last attempt failed; cleared by asking again. */
  image_error: string | null;
  /** What kind of dish; null until known (the bulk run finds out). Only a hoofdgerecht is planned. */
  course: Course | null;
  /** course === 'hoofdgerecht'. */
  main_course: boolean;
  /** A dinner that cannot carry the full vegetable aim (pizza night): at most once a week. */
  veg_exception: boolean;
  /** Grams of vegetables per serving, from the ingredients. */
  veg_per_serving: number;
  /** Vegetable lines that could not be weighed, so are not in the count. */
  veg_unweighed: string[];
  /** Estimated from the ingredients, per serving. */
  carbs_per_serving: number;
  protein_per_serving: number;
  /** What a dinner lacks to be a whole meal; empty for a whole meal and for other dishes. */
  meal_missing: MealPart[];
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
  counts: { dinners: number; below: number; incomplete: number; unknown: number; to_do: number; not_main: number };
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
  /**
   * Left out to keep what the recipe has (or the default, hoofdgerecht, for a
   * new one); null only on the way into the editor, for a recipe whose kind is not known yet.
   */
  course?: Course | null;
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
  stars: number;
  notes: string | null;
  created_at: string;
}

export interface MenuPreview {
  week_number: number;
  year: number;
  replaces: boolean;
  snack_suggestions: string[];
  extras: Array<Omit<MenuExtra, 'id' | 'menu_id'> & { new_recipe: boolean }>;
  days: Array<{
    day_name: string;
    date: string | null;
    recipe_id: number | null;
    recipe_name: string;
    meal_type: string | null;
    prep_time_minutes: number | null;
    recipe_image_version: number | null;
    new_recipe: boolean;
  }>;
}

export interface FeedbackExport {
  text: string;
  feedback: Array<{
    week_number: number;
    year: number;
    day_name: string;
    recipe_name: string;
    meal_type: string;
    stars: number;
    notes: string | null;
  }>;
}

// Menu API
export const api = {
  getMenus: () => request<Menu[]>('/menus'),
  getActiveMenu: () => request<(Menu & { days: MenuDay[] }) | null>('/menus/active'),
  getMenu: (id: number) => request<Menu & { days: MenuDay[] }>(`/menus/${id}`),
  getTargetWeek: () => request<{ weekNumber: number; year: number }>('/menus/target-week'),
  previewMenu: (data: { menu: unknown; weekNumber?: number; year?: number }) =>
    request<MenuPreview>('/menus/preview', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importMenu: (data: { menu: unknown; weekNumber?: number; year?: number }) =>
    request<Menu & { days: MenuDay[] }>('/menus/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getArchive: () => request<ArchivedMenu[]>('/menus/archive'),
  setMenuStatus: (id: number, status: 'active' | 'archived') =>
    request<Menu & { days: MenuDay[] }>(`/menus/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  deleteMenu: (id: number) =>
    request<{ ok: boolean }>(`/menus/${id}`, { method: 'DELETE' }),
  deleteDay: (menuId: number, dayId: number) =>
    request<{ ok: boolean }>(`/menus/${menuId}/days/${dayId}`, { method: 'DELETE' }),
  completeDay: (menuId: number, dayId: number) =>
    request<MenuDay>(`/menus/${menuId}/days/${dayId}/complete`, { method: 'PATCH' }),

  // Feedback
  saveFeedback: (menuId: number, dayId: number, stars: number, notes?: string) =>
    request<Feedback>(`/menus/${menuId}/days/${dayId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ stars, notes }),
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
  checkAllShopping: (menuId: number, checked: boolean) =>
    request<{ items: ShoppingItem[]; grouped: Record<string, ShoppingItem[]> }>(`/menus/${menuId}/shopping/check-all`, {
      method: 'POST',
      body: JSON.stringify({ checked }),
    }),
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
  /** `household`: scale to the household's servings first (imports). */
  createRecipe: (recipe: RecipeInput, options: { household?: boolean } = {}) =>
    request<Recipe>(`/recipes${options.household ? '?household=1' : ''}`, { method: 'POST', body: JSON.stringify(recipe) }),
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

export interface PicnicStatus {
  connected: boolean;
  awaitingCode: boolean;
  email: string | null;
}

export interface PicnicProduct {
  id: string;
  name: string;
  unit_quantity: string | null;
  /** Cents. */
  price: number | null;
  frozen?: boolean;
  organic?: boolean;
  house_brand?: boolean;
}

export interface PicnicSuggestion {
  item_id: number;
  item_name: string;
  quantity: string | null;
  product_group: string;
  /** What was searched for; the starting point for another search. */
  query: string;
  product: PicnicProduct | null;
  /** The product chosen before, with today's name, pack and price. */
  remembered: boolean;
  /** That product was picked by hand, so it stays the choice. */
  picked: boolean;
  /** The product chosen before when Picnic no longer has it; product is a replacement. */
  previous: string | null;
  count: number;
  selected: boolean;
  /** Why it is off (voorraadkast, kaasboer, …) or what to look at (only frozen found). */
  note: string | null;
  /** Search hits, best fit first, each with the packs it takes for this item. */
  alternatives: PicnicCountedProduct[];
}

export type PicnicCountedProduct = PicnicProduct & { count: number };

export interface PicnicAddResult {
  added: number;
  total_count: number;
  total_price: number;
}

/** An earlier attempt that did not settle; it holds its items until it does. */
export interface PicnicUnfinished {
  request_id: string;
  items: string[];
}

export const picnicApi = {
  status: () => request<PicnicStatus>('/picnic/status'),
  login: (email: string, password: string) =>
    request<{ awaitingCode: boolean }>('/picnic/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  verify: (code: string) =>
    request<PicnicStatus>('/picnic/verify', { method: 'POST', body: JSON.stringify({ code }) }),
  resend: () => request<{ ok: true }>('/picnic/resend', { method: 'POST' }),
  logout: () => request<PicnicStatus>('/picnic/logout', { method: 'POST' }),
  /** Hits for one shopping item, each with the packs it takes. */
  searchForItem: (itemId: number, q: string) =>
    request<PicnicCountedProduct[]>(`/picnic/search?item=${itemId}&q=${encodeURIComponent(q)}`),
  /** Suggestions, unless an earlier attempt still has to be settled first. */
  suggestions: (menuId: number) =>
    request<{ items: PicnicSuggestion[]; unfinished: PicnicUnfinished[] }>(`/picnic/menus/${menuId}/suggestions`),
  /** Attempts that did not settle; they hold their items until they do. */
  unfinished: (menuId: number) => request<PicnicUnfinished[]>(`/picnic/menus/${menuId}/unfinished`),
  /** Carry on with an unsettled attempt: looks in the basket, sends only what is missing. */
  finishAttempt: (menuId: number, requestId: string) =>
    request<PicnicAddResult>(`/picnic/menus/${menuId}/cart/${requestId}/finish`, { method: 'POST' }),
  /** Give it up: ticks off what went in, lets the rest go. */
  abandonAttempt: (menuId: number, requestId: string) =>
    request<{ open: string[]; partly: string }>(`/picnic/menus/${menuId}/cart/${requestId}/abandon`, { method: 'POST' }),
  /** A retry of the same attempt must carry the same requestId, so nothing is added twice. */
  addToCart: (menuId: number, requestId: string, lines: Array<{ item_id: number; product: PicnicProduct; count: number; picked: boolean }>) =>
    request<PicnicAddResult>(`/picnic/menus/${menuId}/cart`, {
      method: 'POST',
      body: JSON.stringify({ request_id: requestId, lines }),
    }),
};
