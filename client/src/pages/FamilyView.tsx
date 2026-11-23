import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Archive, ArrowUpDown } from 'lucide-react';
import { useActiveMenu } from '../hooks/useMenu';
import DayCard from '../components/DayCard';
import TodayCard from '../components/TodayCard';
import ExtraCard from '../components/ExtraCard';
import WeekSwitcher from '../components/WeekSwitcher';
import ReorderDays from '../components/ReorderDays';
import { MenuDay, formatDateRange, formatShortDay, safeJsonParse, todayStr } from '../lib/api';
import { VEGETABLE_DAYTIME, VEGETABLE_TARGET } from '../lib/vegetables';

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

function SectionLabel({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mt-8 mb-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-accent">{children}</h2>
      {action}
    </div>
  );
}

export default function FamilyView() {
  const { menu, loading, error, refresh } = useActiveMenu();
  const navigate = useNavigate();
  // null: the week of today, else the next one coming up
  const [weekIndex, setWeekIndex] = useState<number | null>(null);
  // Days ticked off or rated here, until the menu is loaded again
  const [changed, setChanged] = useState<Record<number, MenuDay>>({});
  // Moving the open week's dinners to other days
  const [reordering, setReordering] = useState(false);

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

  // Tonight is the server's choice: today's dinner, or an uneaten one from earlier when that was
  // eaten already. It shows on the running week; uneaten days stay with the rest, eaten ones move down
  const tonight = index === homeIndex ? allDays.find(d => d.id === menu?.tonight_id) : undefined;
  const byDate = (a: MenuDay, b: MenuDay) => (a.date ?? '').localeCompare(b.date ?? '');
  const toCook = week.filter(d => d !== tonight && d.status !== 'completed').sort(byDate);
  const eaten = week.filter(d => d !== tonight && d.status === 'completed').sort(byDate);
  const snacks = safeJsonParse<string[]>(menu?.snack_suggestions ?? null, []);
  const extras = (menu?.extras ?? []).filter(e => e.menu_id === week[0]?.menu_id);
  // The dinners still to come can swap days; eaten ones stay where they were
  const movable = when === 'past' ? [] : week.filter(d => d.status !== 'completed').sort(byDate);
  // With one dinner or none left to move, the week shows as usual again
  const editing = reordering && movable.length > 1;

  async function reordered() {
    await refresh({ quiet: true });
    // The days moved, so what was ticked off here is read again from the server
    setChanged({});
    setReordering(false);
  }

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
              onPrev={() => { setReordering(false); setWeekIndex(index - 1); }}
              onNext={() => { setReordering(false); setWeekIndex(index + 1); }}
              onToday={() => { setReordering(false); setWeekIndex(null); }}
            />
          </div>
        )}
      </header>

      {editing && (
        <>
          <SectionLabel>Volgorde wijzigen</SectionLabel>
          <ReorderDays days={movable} onSaved={reordered} onCancel={() => setReordering(false)} />
        </>
      )}

      {!editing && tonight && (
        <div className="mt-8">
          <TodayCard day={tonight} onChange={(d) => setChanged((c) => ({ ...c, [d.id]: d }))} />
        </div>
      )}

      {when === 'future' && firstDate && (
        <p className="text-sm text-muted">Deze week begint {formatShortDay({ date: firstDate, day_name: '' })}.</p>
      )}

      {!editing && toCook.length > 0 && (
        <>
          <SectionLabel action={movable.length > 1 && (
            <button onClick={() => setReordering(true)}
              className="flex items-center gap-1.5 min-h-9 px-3 rounded-full text-xs font-bold text-muted hover:text-ink hover:bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <ArrowUpDown size={14} /> Volgorde wijzigen
            </button>
          )}>{tonight ? 'Hierna' : when === 'future' ? 'Op het menu' : 'Nog te koken'}</SectionLabel>
          <div className="space-y-3">
            {toCook.map((day) => (
              <DayCard key={day.id} day={day} onClick={() => navigate(`/dag/${day.id}`)} />
            ))}
          </div>
        </>
      )}

      {!tonight && toCook.length === 0 && (
        <p className="text-center text-muted py-8">Alles van deze week is gegeten.</p>
      )}

      {extras.length > 0 && (
        <>
          <SectionLabel>Ontbijt & tussendoortjes</SectionLabel>
          <div className="space-y-3">
            {extras.map((extra) => (
              <ExtraCard key={extra.id} extra={extra} onClick={() => navigate(`/recepten/${extra.recipe_id}`)} />
            ))}
          </div>
        </>
      )}

      {/* Dinner carries part of the day's vegetables; the rest is eaten during the day */}
      {when !== 'past' && (toCook.length > 0 || tonight) && (
        <p className="mt-6 text-xs text-muted">
          Groente: 's avonds minstens {VEGETABLE_TARGET} g per persoon. Overdag nog zo'n {VEGETABLE_DAYTIME} g: snoepgroente,
          bij de lunch of als tussendoortje.
        </p>
      )}

      {eaten.length > 0 && (
        <>
          <SectionLabel>Gegeten</SectionLabel>
          <div className="space-y-3">
            {eaten.map((day) => (
              <DayCard key={day.id} day={day} isCompleted onClick={() => navigate(`/dag/${day.id}`)} />
            ))}
          </div>
        </>
      )}

      {/* Loose ideas from older menus; a week with snacks from the library has those instead */}
      {snacks.length > 0 && !extras.some(e => e.kind === 'snack') && (
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
