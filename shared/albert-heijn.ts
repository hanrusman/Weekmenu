export interface AhProduct {
  id: string;
  name: string;
  unit_quantity: string | null;
  /** Cents; null when AH did not provide a price. */
  price: number | null;
  frozen: boolean | null;
  organic: boolean;
  house_brand: boolean;
}

export type AhCountedProduct = AhProduct & { count: number };
export interface AhSuggestion {
  item_id: number;
  item_name: string;
  quantity: string | null;
  product_group: string;
  query: string;
  product: AhProduct | null;
  count: number;
  selected: boolean;
  picked: boolean;
  remembered: boolean;
  note: string | null;
  alternatives: AhCountedProduct[];
}
export interface AhLine {
  item_id: number;
  product: AhProduct;
  count: number;
  picked: boolean;
}
export interface AhAttempt {
  request_id: string;
  menu_id: number;
  items: string[];
}
export interface AhStatus { connected: boolean; login_url: string }
export interface AhAddResult { added: number; partly?: string[] }
