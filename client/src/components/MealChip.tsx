import type { Recipe } from '../lib/api';

/**
 * What a dinner lacks to be a whole meal ("mist koolhydraten"), with the
 * estimate per serving on hover; nothing for a whole meal or another dish.
 */
export default function MealChip({ recipe }: { recipe: Pick<Recipe, 'meal_missing' | 'carbs_per_serving' | 'protein_per_serving'> }) {
  if (recipe.meal_missing.length === 0) return null;
  return (
    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold text-[10px]"
      title={`Geschat per persoon: ${recipe.carbs_per_serving} g koolhydraten, ${recipe.protein_per_serving} g eiwit`}>
      mist {recipe.meal_missing.join(' en ')}
    </span>
  );
}
