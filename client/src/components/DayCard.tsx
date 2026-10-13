import { Check, ChevronRight, Clock } from 'lucide-react';
import { MenuDay, formatShortDay } from '../lib/api';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from './MealImage';
import { StarScore } from './Stars';

interface DayCardProps {
  day: MenuDay;
  isCompleted?: boolean;
  /** Its day is over but nobody ticked it off. */
  isPast?: boolean;
  onClick?: () => void;
}

/** One planned dinner as a compact row: picture, day, name and time. */
export default function DayCard({ day, isCompleted, isPast, onClick }: DayCardProps) {
  const dimmed = isCompleted || isPast;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-3 pr-4 rounded-3xl text-left transition-all
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand
        ${isPast ? 'border border-dashed border-line' : 'bg-surface shadow-[0_4px_20px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_28px_rgba(0,0,0,0.08)]'}`}
    >
      <div className={`w-16 h-16 shrink-0 rounded-2xl bg-sunken flex items-center justify-center overflow-hidden ${dimmed ? 'opacity-60' : ''}`}>
        <MealImage
          ownSrc={recipeImageUrl(day.recipe_id, day.recipe_image_version)}
          recipeName={day.recipe_name}
          mealType={day.meal_type}
          size={64}
          className={`w-16 h-16 ${isCompleted ? 'grayscale' : ''}`}
          fallback={<span className="text-3xl">{MEAL_TYPE_EMOJI[day.meal_type] || '🍽️'}</span>}
        />
      </div>

      <div className="flex-1 min-w-0">
        <span className="block text-[11px] font-bold tracking-wider uppercase text-accent">
          {formatShortDay(day)}
        </span>
        <h3 className={`font-bold leading-snug line-clamp-2 ${dimmed ? 'text-muted' : ''}`}>
          {day.recipe_name}
        </h3>
        <div className="flex items-center gap-3 mt-1 text-xs font-medium text-muted">
          {isCompleted ? (
            day.stars ? <StarScore stars={day.stars} /> : (
              <span className="inline-flex items-center gap-1 text-success"><Check size={13} /> gegeten</span>
            )
          ) : isPast ? (
            <span>niet afgevinkt</span>
          ) : day.prep_time_minutes ? (
            <span className="inline-flex items-center gap-1"><Clock size={13} /> {day.prep_time_minutes} min</span>
          ) : null}
        </div>
      </div>

      <ChevronRight size={18} className="text-faint shrink-0" />
    </button>
  );
}
