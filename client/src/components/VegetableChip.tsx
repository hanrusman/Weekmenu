import type { Recipe } from '../lib/api';
import { COURSE_LABELS } from '../lib/courses';
import { VEGETABLE_MINIMUM, vegetableNorm } from '../lib/vegetables';

/**
 * Grams of vegetables per serving, coloured by the recipe's norm: green when
 * reached, amber above the bare minimum, red below it. A recipe that is no
 * dinner says what kind of dish it is instead.
 */
export default function VegetableChip({ recipe }: {
  recipe: Pick<Recipe, 'course' | 'main_course' | 'veg_exception' | 'veg_per_serving' | 'veg_unweighed'>;
}) {
  if (!recipe.main_course) {
    return (
      <span className="px-2 py-0.5 rounded-full bg-raised text-muted font-bold text-[10px] uppercase tracking-wide">
        {recipe.course ? COURSE_LABELS[recipe.course] : 'soort onbekend'}
      </span>
    );
  }
  const g = recipe.veg_per_serving;
  const colour = g >= vegetableNorm(recipe) ? 'bg-success-soft text-success'
    : g >= VEGETABLE_MINIMUM ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger';
  const unweighed = recipe.veg_unweighed.length ? ` · niet meegeteld: ${recipe.veg_unweighed.join(', ')}` : '';
  return (
    <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] ${colour}`}
      title={`${g} g groente per persoon, norm ${vegetableNorm(recipe)} g${unweighed}`}>
      🥦 {g} g{recipe.veg_unweighed.length ? '+' : ''}{recipe.veg_exception ? ' · uitzondering' : ''}
    </span>
  );
}
