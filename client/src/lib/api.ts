const BASE = '/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface MenuDay {
  id: number;
  menu_id: number;
  day_of_week: number;
  day_name: string;
  recipe_name: string;
  recipe_data: string;
  meal_type: string;
  prep_time_minutes: number;
  cost_index: string;
  status: string;
  completed_at: string | null;
  notes: string | null;
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

// Menu API
export const api = {
  getMenus: () => request<Menu[]>('/menus'),
  getActiveMenu: () => request<(Menu & { days: MenuDay[] }) | null>('/menus/active'),
  getMenu: (id: number) => request<Menu & { days: MenuDay[] }>(`/menus/${id}`),
  generateMenu: (data?: { weekNumber?: number; year?: number; preferences?: string }) =>
    request<Menu & { days: MenuDay[] }>('/menus/generate', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  updateMenuStatus: (id: number, status: string) =>
    request<Menu & { days: MenuDay[] }>(`/menus/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  approveDay: (menuId: number, dayId: number) =>
    request<MenuDay>(`/menus/${menuId}/days/${dayId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved' }),
    }),
  regenerateDay: (menuId: number, dayId: number) =>
    request<MenuDay>(`/menus/${menuId}/days/${dayId}/regenerate`, { method: 'POST' }),
  completeDay: (menuId: number, dayId: number) =>
    request<MenuDay>(`/menus/${menuId}/days/${dayId}/complete`, { method: 'PATCH' }),

  // Shopping
  getShopping: (menuId: number) =>
    request<{ items: ShoppingItem[]; grouped: Record<string, ShoppingItem[]> }>(`/menus/${menuId}/shopping`),
  toggleShoppingItem: (menuId: number, itemId: number, checked: boolean) =>
    request<ShoppingItem>(`/menus/${menuId}/shopping/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ checked }),
    }),

  // Pantry
  getPantry: (menuId: number) => request<PantryItem[]>(`/menus/${menuId}/pantry`),
  togglePantryItem: (menuId: number, itemId: number, have_it: boolean) =>
    request<PantryItem>(`/menus/${menuId}/pantry/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ have_it }),
    }),

  // Recipes
  getRecipes: (search?: string) =>
    request<Recipe[]>(`/recipes${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  addRecipe: (data: { name: string; recipe_data: object; tags?: string[]; source?: string }) =>
    request<Recipe>('/recipes', { method: 'POST', body: JSON.stringify(data) }),
  deleteRecipe: (id: number) =>
    request<{ ok: boolean }>(`/recipes/${id}`, { method: 'DELETE' }),

  // Today
  getToday: () => request<{ recipe_name: string; prep_time_minutes: number; meal_type: string; cost_index: string }>('/today'),
};
