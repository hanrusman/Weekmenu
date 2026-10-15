import { ChevronRight, Clock } from 'lucide-react';
import { MenuExtra, formatShortDay } from '../lib/api';
import { recipeImageUrl } from '../lib/mealImages';
import MealImage from './MealImage';

export const EXTRA_LABEL: Record<MenuExtra['kind'], string> = { ontbijt: 'Ontbijt', snack: 'Tussendoortje' };

/** "Ontbijt · za 17 okt", or just "Tussendoortje" when it belongs to no day. */
export function extraLabel(extra: Pick<MenuExtra, 'kind' | 'day_name' | 'date'>): string {
  const label = EXTRA_LABEL[extra.kind];
  return extra.day_name ? `${label} · ${formatShortDay({ date: extra.date, day_name: extra.day_name })}` : label;
}

/** One of the week's breakfasts or snacks as a compact row, like a dinner's. */
export default function ExtraCard({ extra, onClick }: { extra: MenuExtra; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 p-3 pr-4 rounded-3xl text-left transition-all
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
        bg-surface shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.08)]"
    >
      <div className="w-12 h-12 shrink-0 rounded-2xl bg-sunken flex items-center justify-center overflow-hidden">
        <MealImage
          ownSrc={recipeImageUrl(extra.recipe_id, extra.recipe_image_version)}
          recipeName={extra.recipe_name}
          mealType={extra.meal_type ?? ''}
          size={48}
          className="w-12 h-12"
          fallback={<span className="text-2xl">{extra.kind === 'ontbijt' ? '🥣' : '🍎'}</span>}
        />
      </div>

      <div className="flex-1 min-w-0">
        <span className="block text-[11px] font-bold tracking-wider uppercase text-accent">{extraLabel(extra)}</span>
        <h3 className="font-bold leading-snug line-clamp-2">{extra.recipe_name}</h3>
        {extra.prep_time_minutes ? (
          <span className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-muted">
            <Clock size={13} /> {extra.prep_time_minutes} min
          </span>
        ) : null}
      </div>

      <ChevronRight size={18} className="text-faint shrink-0" />
    </button>
  );
}
