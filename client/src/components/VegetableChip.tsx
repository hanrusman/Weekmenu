import type { Recipe } from '../lib/api';
import { VEGETABLE_MINIMUM, vegetableNorm } from '../lib/vegetables';

/**
 * Grams of vegetables per serving, coloured by the recipe's norm: green when
 * reached, amber above the bare minimum, red below it. A recipe that is no
 * dinner says so instead.
 */
export default function VegetableChip({ recipe }: { recipe: Pick<Recipe, 'main_course' | 'veg_exception' | 'veg_per_serving' | 'veg_unweighed'> }) {
  if (!recipe.main_course) {
    return <span className="px-2 py-0.5 rounded-full bg-gray-100 text-muted font-bold text-[10px] uppercase tracking-wide">geen hoofdgerecht</span>;
  }
  const g = recipe.veg_per_serving;
  const colour = g >= vegetableNorm(recipe) ? 'bg-green-100 text-green-700'
    : g >= VEGETABLE_MINIMUM ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  const unweighed = recipe.veg_unweighed.length ? ` · niet meegeteld: ${recipe.veg_unweighed.join(', ')}` : '';
  return (
    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${colour}`}
      title={`${g} g groente per persoon, norm ${vegetableNorm(recipe)} g${unweighed}`}>
      🥦 {g} g{recipe.veg_unweighed.length ? '+' : ''}{recipe.veg_exception ? ' · uitzondering' : ''}
    </span>
  );
}
