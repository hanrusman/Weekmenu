import { useNavigate } from 'react-router-dom';
import { useActiveMenu } from '../hooks/useMenu';
import DayCard from '../components/DayCard';
import { MenuDay, safeJsonParse } from '../lib/api';

function todayDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export default function FamilyView() {
  const { menu, loading, error } = useActiveMenu();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-4xl animate-cook mb-4">🍳</div>
          <p className="text-gray-500 dark:text-gray-400">Menu laden...</p>
        </div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="p-6 max-w-lg mx-auto pt-12">
        <div className="text-center py-16">
          <div className="text-4xl mb-4">🍽️</div>
          <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Geen actief menu
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Ga naar Admin om een weekmenu te importeren.
          </p>
        </div>
      </div>
    );
  }

  const today = todayDateStr();
  const days = menu.days || [];
  const completedDays = days.filter((d: MenuDay) => d.status === 'completed');
  const activeDays = days.filter((d: MenuDay) => d.status !== 'completed');

  // Sort: today first, then remaining in order
  const todayDay = activeDays.find((d: MenuDay) => d.date === today);
  const otherDays = activeDays.filter((d: MenuDay) => d.date !== today);

  return (
    <div className="p-4 max-w-lg mx-auto pt-12">
      <h1 className="text-2xl font-bold text-forest-700 dark:text-forest-500 mb-1">
        Deze week
      </h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        Week {menu.week_number} — {menu.year}
      </p>

      <div className="space-y-3">
        {todayDay && (
          <DayCard
            day={todayDay}
            isToday
            onClick={() => navigate(`/dag/${todayDay.id}`)}
          />
        )}

        {otherDays.map((day: MenuDay) => (
          <DayCard
            key={day.id}
            day={day}
            onClick={() => navigate(`/dag/${day.id}`)}
          />
        ))}

        {completedDays.length > 0 && (
          <>
            <div className="flex items-center gap-3 mt-6 mb-2">
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
              <span className="text-xs text-gray-400 uppercase tracking-wider">gedaan</span>
              <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
            </div>
            {completedDays.map((day: MenuDay) => (
              <DayCard
                key={day.id}
                day={day}
                isCompleted
                onClick={() => navigate(`/dag/${day.id}`)}
              />
            ))}
          </>
        )}
      </div>

      {menu.snack_suggestions && (
        <div className="mt-8 p-4 bg-cream-200 dark:bg-gray-800 rounded-xl">
          <h3 className="font-semibold text-sm text-gray-600 dark:text-gray-400 mb-2">
            🍎 Tussendoortjes
          </h3>
          <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {safeJsonParse<string[]>(menu.snack_suggestions, []).map((snack: string, i: number) => (
              <li key={i}>• {snack}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
