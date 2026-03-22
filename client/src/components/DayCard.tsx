import { MenuDay } from '../lib/api';

interface DayCardProps {
  day: MenuDay;
  isToday?: boolean;
  isCompleted?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
}

const mealTypeEmoji: Record<string, string> = {
  pasta: '🍝',
  rijst: '🍚',
  wrap: '🌯',
  oven: '🫕',
  salade: '🥗',
  vrij: '🍳',
};

export default function DayCard({
  day,
  isToday,
  isCompleted,
  onClick,
  onDelete,
}: DayCardProps) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-4 transition-all ${
        isToday
          ? 'bg-forest-500 text-white shadow-lg ring-2 ring-forest-500 ring-offset-2 dark:ring-offset-gray-900'
          : isCompleted
            ? 'bg-gray-50 dark:bg-gray-800 opacity-60'
            : 'bg-white dark:bg-gray-800 shadow-sm hover:shadow-md'
      } ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm font-medium opacity-75">
          {isToday && 'VANDAAG — '}
          {day.day_name}
        </span>
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="text-red-400 hover:text-red-600 text-xs px-1 -mt-1 -mr-1"
            aria-label={`Verwijder ${day.day_name}`}
          >
            x
          </button>
        )}
      </div>

      <h3 className={`font-semibold text-lg mb-2 ${isCompleted ? 'line-through' : ''}`}>
        {mealTypeEmoji[day.meal_type] || '🍽️'} {day.recipe_name}
      </h3>

      <div className="flex gap-3 text-sm opacity-75">
        <span>{day.prep_time_minutes} min</span>
        <span>{day.cost_index}</span>
        <span className="capitalize">{day.meal_type}</span>
      </div>
    </div>
  );
}
