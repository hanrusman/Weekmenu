import type { DraftDay, PlannerRecipe } from './menu-rules';

/** A breakfast or snack the picker offers. */
export interface PlannerExtra {
  id: number;
  name: string;
  status: string;
  prep_time_minutes: number | null;
  recipe_image_version: number | null;
}

/** A model's week, checked: what it chose and what it still breaks. */
export interface MenuProposal {
  days: DraftDay[];
  breakfasts: number[];
  snacks: number[];
  /** The model's own explanation. */
  note: string;
  model: string;
  /** Rules the proposal still breaks after the last attempt, and preferences it misses. */
  fails: string[];
  warnings: string[];
}

/** The proposal running in the background (one at a time), or the last one. */
export interface ProposalJob {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  week_number: number | null;
  year: number | null;
  attempt: number;
  attempts: number;
  model: string | null;
  proposal: MenuProposal | null;
  error: string | null;
}

/** What the picker needs for one week. */
export interface PlannerState {
  /** Whether a model can propose (LITELLM_URL / LITELLM_API_KEY). */
  configured: boolean;
  week_number: number;
  year: number;
  previous: { week_number: number; year: number };
  next: { week_number: number; year: number };
  /** The week's days, Thursday to Wednesday, with dates. */
  days: Array<{ day_name: string; date: string }>;
  /** The menu that is there for this week already; saving replaces it. */
  existing: { status: string; days: Array<{ day_name: string; recipe_id: number | null }>; breakfasts: number[]; snacks: number[] } | null;
  /** Dinners: approved and concept, plus whatever the existing menu has. */
  recipes: PlannerRecipe[];
  breakfasts: PlannerExtra[];
  snacks: PlannerExtra[];
  per_week: { breakfasts: number; snacks: number };
  job: ProposalJob;
}

/** What the picker asks the model: fill the open days around the chosen ones. */
export interface ProposalRequest {
  week_number: number;
  year: number;
  days: Array<{ day_name: string; recipe_id: number | null; free?: boolean }>;
  breakfasts: number[];
  snacks: number[];
  wishes: string;
}
