import { motion } from 'motion/react';
import { Clock } from 'lucide-react';
import { MenuDay, formatDayLabel } from '../lib/api';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from './MealImage';

interface DayCardProps {
  day: MenuDay;
  isToday?: boolean;
  isCompleted?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

function MealVisual({ day, isCompleted }: { day: MenuDay; isCompleted?: boolean }) {
  return (
    <MealImage
      ownSrc={recipeImageUrl(day.recipe_id, day.recipe_image_version)}
      recipeName={day.recipe_name}
      mealType={day.meal_type}
      size={96}
      className={`block w-24 h-24 mx-auto mb-3 ${isCompleted ? 'grayscale opacity-50' : ''}`}
      fallback={
        <div className={`text-5xl mb-3 ${isCompleted ? 'grayscale' : ''}`}>
          {MEAL_TYPE_EMOJI[day.meal_type] || '🍽️'}
        </div>
      }
    />
  );
}

export default function DayCard({
  day,
  isToday,
  isCompleted,
  onClick,
  onDelete,
}: DayCardProps) {
  return (
    <motion.button
      whileHover={{ y: -4, boxShadow: '0 20px 40px rgba(0,0,0,0.06)' }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`relative w-full bg-white p-6 rounded-4xl text-center transition-all duration-300 border-2 ${
        isToday
          ? 'border-warmth-400 shadow-[0_15px_35px_rgba(245,217,193,0.3)]'
          : isCompleted
            ? 'border-transparent opacity-50'
            : 'border-transparent shadow-[0_4px_20px_rgba(0,0,0,0.03)]'
      }`}
    >
      {isToday && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-warmth-500 text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wider">
          VANDAAG
        </div>
      )}

      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute top-3 right-4 text-gray-300 hover:text-red-400 text-sm"
          aria-label={`Verwijder ${day.day_name}`}
        >
          x
        </button>
      )}

      <span className="block text-[11px] font-bold tracking-[0.2em] text-accent mb-3 uppercase">
        {formatDayLabel(day)}
      </span>

      <MealVisual day={day} isCompleted={isCompleted} />

      <h3 className={`font-bold text-base mb-2 tracking-tight leading-tight ${isCompleted ? 'line-through text-gray-400' : ''}`}>
        {day.recipe_name}
      </h3>

      {day.prep_time_minutes ? (
        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted">
          <Clock size={13} />
          <span>{day.prep_time_minutes}m</span>
        </div>
      ) : null}
    </motion.button>
  );
}
