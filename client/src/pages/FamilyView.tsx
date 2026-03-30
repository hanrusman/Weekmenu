import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m1 - 1]}`;
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
          <p className="text-muted">Menu laden...</p>
        </div>
      </div>
    );
  }

  if (error || !menu) {
    return (
      <div className="p-6 max-w-2xl mx-auto pt-16">
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🍽️</div>
          <h2 className="text-xl font-bold mb-2">Geen actief menu</h2>
          <p className="text-muted">Ga naar Admin om een weekmenu te importeren.</p>
        </div>
      </div>
    );
  }

  const today = todayDateStr();
  const allDays = menu.days || [];

  const weekMap = new Map<number, MenuDay[]>();
  for (const day of allDays) {
    if (!weekMap.has(day.menu_id)) weekMap.set(day.menu_id, []);
    weekMap.get(day.menu_id)!.push(day);
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) =>
    (a[0]?.date || '').localeCompare(b[0]?.date || '')
  );

  const todayWeekIdx = weeks.findIndex(w => w.some(d => d.date === today));
  const effectiveIndex = weekIndex === 0 && todayWeekIdx >= 0 ? todayWeekIdx : weekIndex;
  const clampedIndex = Math.max(0, Math.min(effectiveIndex, weeks.length - 1));

  if (weeks.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto pt-16">
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🍽️</div>
          <p className="text-muted">Geen actief menu</p>
        </div>
      </div>
    );
  }

  const currentWeek = weeks[clampedIndex];
  const completedDays = currentWeek.filter(d => d.status === 'completed');
  const activeDays = currentWeek.filter(d => d.status !== 'completed');
  const todayDay = activeDays.find(d => d.date === today);
  const otherDays = activeDays.filter(d => d.date !== today);
  const snackSuggestions = menu.snack_suggestions;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto pt-8 md:pt-12">
      {/* Header */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Eten deze week
          </h1>
          <p className="text-muted text-base mt-1">
            {weekLabel(currentWeek)}
          </p>
        </div>

        {weeks.length > 1 && (
          <div className="flex items-center bg-white rounded-full px-2 py-2 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-gray-100">
            <button
              onClick={() => setWeekIndex(clampedIndex - 1)}
              disabled={clampedIndex <= 0}
              className="p-2 hover:bg-gray-50 rounded-full transition-colors text-gray-400 disabled:opacity-25"
              aria-label="Vorige week"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="font-bold text-sm px-3 whitespace-nowrap">
              {clampedIndex + 1} / {weeks.length}
            </span>
            <button
              onClick={() => setWeekIndex(clampedIndex + 1)}
              disabled={clampedIndex >= weeks.length - 1}
              className="p-2 hover:bg-gray-50 rounded-full transition-colors text-gray-400 disabled:opacity-25"
              aria-label="Volgende week"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </header>

      {/* Meal grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
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
      </div>

      {/* Completed */}
      {completedDays.length > 0 && (
        <>
          <div className="flex items-center gap-3 mt-10 mb-4">
            <div className="h-px flex-1 bg-gray-200" />
            <span className="text-xs text-muted uppercase tracking-[0.2em] font-medium">gedaan</span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
            {completedDays.map((day: MenuDay) => (
              <DayCard
                key={day.id}
                day={day}
                isCompleted
                onClick={() => navigate(`/dag/${day.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {/* Snacks */}
      {snackSuggestions && (
        <div className="mt-10 bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <h3 className="font-bold text-sm tracking-wide text-accent mb-3 uppercase">
            Tussendoortjes
          </h3>
          <ul className="text-sm text-muted space-y-1">
            {safeJsonParse<string[]>(snackSuggestions, []).map((snack: string, i: number) => (
              <li key={i}>• {snack}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
