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

export interface Recipe {
  id: number;
  name: string;
  source: string;
  recipe_data: string;
  tags: string;
  times_used: number;
  last_used: string | null;
  created_at: string;
}

export interface RecipeData {
  ingredients: Array<{
    name: string;
    amount: string;
    unit: string;
    product_group: string;
  }>;
  steps: string[];
  nutrition_per_serving: {
    calories: number;
    protein_g: number;
    fiber_g: number;
    iron_mg: number;
  };
  tip?: string;
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

  // Pantry per menu
  getPantry: (menuId: number) => request<PantryItem[]>(`/menus/${menuId}/pantry`),
  togglePantryItem: (menuId: number, itemId: number, have_it: boolean) =>
    request<PantryItem>(`/menus/${menuId}/pantry/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ have_it }),
    }),

  // Recipes
  getRecipes: (search?: string) =>
    request<Recipe[]>(`/recipes${search ? `?search=${encodeURIComponent(search)}` : ''}`),

  // Single day (avoids N+1)
  getDay: (dayId: number) => request<MenuDay>(`/days/${dayId}`),
};

export function safeJsonParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str) as T; } catch { return fallback; }
}
