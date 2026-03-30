import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveMenu } from '../hooks/useMenu';
import DayCard from '../components/DayCard';
import { MenuDay, safeJsonParse } from '../lib/api';

function todayDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

function weekLabel(days: MenuDay[]): string {
  const dates = days.map(d => d.date).filter(Boolean).sort();
  if (dates.length === 0) return '';
  const first = dates[0]!;
  const last = dates[dates.length - 1]!;
  const [, m1, d1] = first.split('-').map(Number);
  const [, m2, d2] = last.split('-').map(Number);
  if (m1 === m2) {
    return `${d1}–${d2} ${MONTHS[m1 - 1]}`;
  }
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

export default function FamilyView() {
  const { menu, loading, error } = useActiveMenu();
  const navigate = useNavigate();
  const [weekIndex, setWeekIndex] = useState(0);

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
  const allDays = menu.days || [];

  // Group days by menu_id to create weeks
  const weekMap = new Map<number, MenuDay[]>();
  for (const day of allDays) {
    if (!weekMap.has(day.menu_id)) weekMap.set(day.menu_id, []);
    weekMap.get(day.menu_id)!.push(day);
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) => {
    const dateA = a[0]?.date || '';
    const dateB = b[0]?.date || '';
    return dateA.localeCompare(dateB);
  });

  // Find the week that contains today, default to that
  const todayWeekIdx = weeks.findIndex(w => w.some(d => d.date === today));
  const effectiveIndex = weekIndex === 0 && todayWeekIdx >= 0 ? todayWeekIdx : weekIndex;
  const clampedIndex = Math.max(0, Math.min(effectiveIndex, weeks.length - 1));

  if (weeks.length === 0) {
    return (
      <div className="p-6 max-w-lg mx-auto pt-12">
        <div className="text-center py-16">
          <div className="text-4xl mb-4">🍽️</div>
          <p className="text-gray-500 dark:text-gray-400">Geen actief menu</p>
        </div>
      </div>
    );
  }

  const currentWeek = weeks[clampedIndex];
  const completedDays = currentWeek.filter(d => d.status === 'completed');
  const activeDays = currentWeek.filter(d => d.status !== 'completed');
  const todayDay = activeDays.find(d => d.date === today);
  const otherDays = activeDays.filter(d => d.date !== today);

  // Get snack suggestions from the menu data
  const snackSuggestions = menu.snack_suggestions;

  return (
    <div className="p-4 max-w-lg mx-auto pt-12">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-forest-700 dark:text-forest-500">
            Eten deze week
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {weekLabel(currentWeek)}
          </p>
        </div>

        {/* Week nav */}
        {weeks.length > 1 && (
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-lg shadow-sm px-1 py-1">
            <button
              onClick={() => setWeekIndex(clampedIndex - 1)}
              disabled={clampedIndex <= 0}
              className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25"
              aria-label="Vorige week"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 px-2">
              {clampedIndex + 1} / {weeks.length}
            </span>
            <button
              onClick={() => setWeekIndex(clampedIndex + 1)}
              disabled={clampedIndex >= weeks.length - 1}
              className="p-1.5 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-25"
              aria-label="Volgende week"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>

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

      {snackSuggestions && (
        <div className="mt-8 p-4 bg-cream-200 dark:bg-gray-800 rounded-xl">
          <h3 className="font-semibold text-sm text-gray-600 dark:text-gray-400 mb-2">
            Tussendoortjes
          </h3>
          <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
            {safeJsonParse<string[]>(snackSuggestions, []).map((snack: string, i: number) => (
              <li key={i}>• {snack}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
