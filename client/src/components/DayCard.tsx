import { MenuDay } from '../lib/api';

interface DayCardProps {
  day: MenuDay;
  isToday?: boolean;
  isCompleted?: boolean;
  showActions?: boolean;
  onApprove?: () => void;
  onRegenerate?: () => void;
  onComplete?: () => void;
  onClick?: () => void;
  regenerating?: boolean;
}

const mealTypeEmoji: Record<string, string> = {
  pasta: '🍝',
  rijst: '🍚',
  wrap: '🌯',
  oven: '🫕',
  salade: '🥗',
  vrij: '🍳',
};

const statusColors: Record<string, string> = {
  proposed: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  completed: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

export default function DayCard({
  day,
  isToday,
  isCompleted,
  showActions,
  onApprove,
  onRegenerate,
  onComplete,
  onClick,
  regenerating,
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
        <div>
          <span className="text-sm font-medium opacity-75">
            {isToday && '★ VANDAAG — '}
            {day.day_name}
          </span>
        </div>
        {!isCompleted && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[day.status] || ''}`}>
            {day.status}
          </span>
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

      {showActions && !isCompleted && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
          {day.status === 'proposed' && (
            <button
              onClick={(e) => { e.stopPropagation(); onApprove?.(); }}
              className="flex-1 py-1.5 px-3 bg-forest-500 text-white rounded-lg text-sm font-medium hover:bg-forest-600 transition-colors"
            >
              ✓ Goedkeuren
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onRegenerate?.(); }}
            disabled={regenerating}
            className="flex-1 py-1.5 px-3 bg-warmth-500 text-white rounded-lg text-sm font-medium hover:bg-warmth-600 transition-colors disabled:opacity-50"
          >
            {regenerating ? '↻ Bezig...' : '↻ Anders'}
          </button>
          {day.status === 'approved' && onComplete && (
            <button
              onClick={(e) => { e.stopPropagation(); onComplete(); }}
              className="flex-1 py-1.5 px-3 bg-gray-200 dark:bg-gray-600 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              ✓ Klaar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
