import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { useActiveMenu } from '../hooks/useMenu';
import DayCard from '../components/DayCard';
import TodayCard from '../components/TodayCard';
import WeekSwitcher from '../components/WeekSwitcher';
import { MenuDay, formatDateRange, formatShortDay, safeJsonParse, todayStr } from '../lib/api';

function dateSpan(days: MenuDay[]): [string | null, string | null] {
  const dates = days.map(d => d.date).filter((d): d is string => !!d).sort();
  return [dates[0] ?? null, dates[dates.length - 1] ?? null];
}

/** Where a week lies from today. */
function weekWhen(days: MenuDay[], today: string): 'past' | 'current' | 'future' {
  const [first, last] = dateSpan(days);
  if (!first || !last || (first <= today && today <= last)) return 'current';
  return first > today ? 'future' : 'past';
}

const TITLES = { current: 'Eten deze week', future: 'Eten volgende week', past: 'Eten vorige week' };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-accent mt-8 mb-3">{children}</h2>;
}

export default function FamilyView() {
  const { menu, loading, error } = useActiveMenu();
  const navigate = useNavigate();
  // null: the week of today, else the next one coming up
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  // Days ticked off or rated here, until the menu is loaded again
  const [changed, setChanged] = useState<Record<number, MenuDay>>({});

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

  const today = todayStr();
  const allDays = (menu?.days || []).map((d) => changed[d.id] ?? d);

  const weekMap = new Map<number, MenuDay[]>();
  for (const day of allDays) {
    if (!weekMap.has(day.menu_id)) weekMap.set(day.menu_id, []);
    weekMap.get(day.menu_id)!.push(day);
  }
  const weeks = Array.from(weekMap.values()).sort((a, b) =>
    (a[0]?.date || '').localeCompare(b[0]?.date || '')
  );

  if (error || weeks.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto pt-16">
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🍽️</div>
          <h2 className="text-xl font-bold mb-2">Geen actief menu</h2>
          <p className="text-muted mb-6">Plan een nieuwe week, of kijk terug naar eerdere weken.</p>
          <div className="flex justify-center gap-3">
            <Link to="/plannen" className="inline-flex items-center min-h-11 px-5 bg-brand text-on-brand rounded-2xl font-bold text-sm hover:bg-brand-hover transition-colors">
              Week plannen
            </Link>
            <Link to="/archief" className="inline-flex items-center min-h-11 px-5 bg-surface border border-line rounded-2xl font-bold text-sm hover:bg-raised transition-colors">
              Archief
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const currentWeekIdx = weeks.findIndex(w => (dateSpan(w)[1] ?? today) >= today);
  const homeIndex = currentWeekIdx >= 0 ? currentWeekIdx : weeks.length - 1;
  const index = Math.max(0, Math.min(weekIndex ?? homeIndex, weeks.length - 1));
  const week = weeks[index];
  const when = weekWhen(week, today);
  const [firstDate, lastDate] = dateSpan(week);

  // Past days and ticked-off days move down; a past day not ticked off stays clickable to tick it still
  const todayDay = week.find(d => d.date === today);
  const isBehind = (d: MenuDay) => d !== todayDay && (d.status === 'completed' || (!!d.date && d.date < today));
  const upcoming = week.filter(d => d !== todayDay && !isBehind(d));
  const behind = week.filter(isBehind);
  const snacks = safeJsonParse<string[]>(menu?.snack_suggestions ?? null, []);

  return (
    <div
      style={{
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
      }}
      className="max-w-2xl mx-auto pt-8 md:pt-12 pb-4 md:pb-8"
    >
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{TITLES[when]}</h1>
            {weeks.length === 1 && (
              <p className="text-muted mt-1">
                Week {week[0]?.week_number} · {formatDateRange(firstDate, lastDate)}
              </p>
            )}
          </div>
          <Link to="/archief" aria-label="Archief"
            className="shrink-0 flex items-center gap-1.5 min-h-11 px-4 rounded-full bg-surface border border-line-soft text-sm font-bold text-muted hover:text-ink hover:bg-raised transition-colors">
            <Archive size={16} />
            <span className="hidden sm:inline">Archief</span>
          </Link>
        </div>

        {weeks.length > 1 && (
          <div className="mt-4">
            <WeekSwitcher
              weekNumber={week[0]?.week_number}
              firstDate={firstDate}
              lastDate={lastDate}
              when={when}
              canPrev={index > 0}
              canNext={index < weeks.length - 1}
              onPrev={() => setWeekIndex(index - 1)}
              onNext={() => setWeekIndex(index + 1)}
              onToday={() => setWeekIndex(null)}
            />
          </div>
        )}
      </header>

      {todayDay && (
        <div className="mt-8">
          <TodayCard day={todayDay} onChange={(d) => setChanged((c) => ({ ...c, [d.id]: d }))} />
        </div>
      )}

      {when === 'future' && firstDate && (
        <p className="text-sm text-muted">Deze week begint {formatShortDay({ date: firstDate, day_name: '' })}.</p>
      )}

      {upcoming.length > 0 && (
        <>
          <SectionLabel>{todayDay ? 'Hierna' : when === 'future' ? 'Op het menu' : 'Nog te koken'}</SectionLabel>
          <div className="space-y-3">
            {upcoming.map((day) => (
              <DayCard key={day.id} day={day} onClick={() => navigate(`/dag/${day.id}`)} />
            ))}
          </div>
        </>
      )}

      {!todayDay && upcoming.length === 0 && (
        <p className="text-center text-muted py-8">Alles van deze week is gegeten.</p>
      )}

      {behind.length > 0 && (
        <>
          <SectionLabel>Geweest</SectionLabel>
          <div className="space-y-3">
            {behind.map((day) => (
              <DayCard
                key={day.id}
                day={day}
                isCompleted={day.status === 'completed'}
                isPast={day.status !== 'completed'}
                onClick={() => navigate(`/dag/${day.id}`)}
              />
            ))}
          </div>
        </>
      )}

      {snacks.length > 0 && (
        <div className="mt-10 bg-surface rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <h3 className="font-bold text-sm tracking-wide text-accent mb-3 uppercase">Tussendoortjes</h3>
          <ul className="text-sm text-muted space-y-1">
            {snacks.map((snack, i) => <li key={i}>• {snack}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
