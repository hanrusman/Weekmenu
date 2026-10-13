import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, RotateCcw, Search, Trash2 } from 'lucide-react';
import { api, ArchivedDay, ArchivedMenu, formatDateRange, formatShortDay } from '../lib/api';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from '../components/MealImage';
import { StarAverage, StarScore } from '../components/Stars';

function DayRow({ day }: { day: ArchivedDay }) {
  const navigate = useNavigate();
  const cooked = day.status === 'completed';
  return (
    <button onClick={() => navigate(`/dag/${day.id}`)}
      className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-sunken rounded-2xl px-2 -mx-2 transition-colors">
      <MealImage
        ownSrc={recipeImageUrl(day.recipe_id, day.recipe_image_version)}
        recipeName={day.recipe_name}
        mealType={day.meal_type}
        size={40}
        className={`w-10 h-10 shrink-0 ${cooked ? '' : 'opacity-60'}`}
        fallback={<span className="w-10 text-center text-2xl shrink-0">{MEAL_TYPE_EMOJI[day.meal_type] || '🍽️'}</span>}
      />
      <span className="w-16 shrink-0 text-[11px] font-bold tracking-wider uppercase text-accent">{formatShortDay(day)}</span>
      <span className={`flex-1 min-w-0 truncate text-sm font-medium ${cooked ? '' : 'text-muted'}`}>{day.recipe_name}</span>
      {day.stars
        ? <StarScore stars={day.stars} size={11} />
        : !cooked && <span className="text-[10px] text-muted whitespace-nowrap">niet afgevinkt</span>}
    </button>
  );
}

interface WeekCardProps {
  menu: ArchivedMenu;
  days: ArchivedDay[];
  open: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onDelete: () => void;
  busy: boolean;
}

function WeekCard({ menu, days, open, onToggle, onRestore, onDelete, busy }: WeekCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const cooked = menu.days.filter((d) => d.status === 'completed').length;
  const rated = menu.days.filter((d) => d.stars);
  const avg = rated.length ? rated.reduce((sum, d) => sum + d.stars!, 0) / rated.length : null;

  return (
    <div className="bg-surface rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] overflow-hidden">
      <button onClick={onToggle} aria-expanded={open}
        className="w-full flex items-center gap-4 p-5 text-left">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="font-bold">Week {menu.week_number}</h3>
            <span className="text-sm text-muted">{formatDateRange(menu.first_date, menu.last_date)}</span>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted mt-1">
            <span>{cooked} van {menu.days.length} afgevinkt</span>
            <StarAverage avg={avg} count={rated.length} />
          </p>
          {!open && (
            <div className="flex -space-x-2 mt-3" aria-hidden>
              {menu.days.slice(0, 7).map((d) => (
                <div key={d.id} className="w-9 h-9 rounded-full bg-sunken ring-2 ring-surface flex items-center justify-center overflow-hidden">
                  <MealImage
                    ownSrc={recipeImageUrl(d.recipe_id, d.recipe_image_version)}
                    recipeName={d.recipe_name}
                    mealType={d.meal_type}
                    size={36}
                    className="w-9 h-9"
                    fallback={<span className="text-base">{MEAL_TYPE_EMOJI[d.meal_type] || '🍽️'}</span>}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <ChevronDown size={18} className={`text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="divide-y divide-line-soft">
            {days.map((d) => <DayRow key={d.id} day={d} />)}
          </div>
          <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-line-soft">
            <button onClick={onRestore} disabled={busy}
              className="flex items-center gap-1.5 text-xs font-bold text-brand hover:text-brand-hover disabled:opacity-50">
              <RotateCcw size={13} />
              Terug op het menu
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-3 text-xs font-bold">
                <span className="text-muted">Week en feedback weg?</span>
                <button onClick={() => setConfirmDelete(false)} className="text-muted hover:text-ink">Nee</button>
                <button onClick={onDelete} disabled={busy} className="text-red-500 hover:text-danger disabled:opacity-50">
                  Verwijder
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={busy}
                className="flex items-center gap-1.5 text-xs font-bold text-muted hover:text-red-500 disabled:opacity-50">
                <Trash2 size={13} />
                Verwijderen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MenuArchive() {
  const [menus, setMenus] = useState<ArchivedMenu[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [restored, setRestored] = useState<ArchivedMenu | null>(null);

  useEffect(() => {
    api.getArchive().then(setMenus).catch((err) => setError((err as Error).message));
  }, []);

  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => (menus ?? [])
    .map((menu) => ({
      menu,
      days: needle ? menu.days.filter((d) => d.recipe_name.toLowerCase().includes(needle)) : menu.days,
    }))
    .filter(({ days }) => !needle || days.length > 0), [menus, needle]);

  const byYear = useMemo(() => {
    const groups = new Map<number, typeof filtered>();
    for (const item of filtered) {
      if (!groups.has(item.menu.year)) groups.set(item.menu.year, []);
      groups.get(item.menu.year)!.push(item);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  function toggle(id: number) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleRestore(menu: ArchivedMenu) {
    setBusyId(menu.id);
    setError(null);
    try {
      await api.setMenuStatus(menu.id, 'active');
      setMenus((prev) => prev?.filter((m) => m.id !== menu.id) ?? null);
      setRestored(menu);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(menu: ArchivedMenu) {
    setBusyId(menu.id);
    setError(null);
    try {
      await api.deleteMenu(menu.id);
      setMenus((prev) => prev?.filter((m) => m.id !== menu.id) ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Archief</h1>
        <p className="text-muted text-sm mt-1">
          Een week gaat hierheen zodra de laatste dag voorbij is.
        </p>
      </header>

      {restored && (
        <div className="bg-success-soft text-success p-4 rounded-2xl mb-4 text-sm flex items-center justify-between gap-3">
          <span>Week {restored.week_number} staat weer op het menu.</span>
          <Link to="/" className="font-bold whitespace-nowrap hover:underline">Naar menu →</Link>
        </div>
      )}

      {error && (
        <div className="bg-danger-soft text-danger p-4 rounded-2xl mb-4 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      {menus === null && !error && (
        <div className="text-center py-16 text-4xl animate-cook">📚</div>
      )}

      {menus && menus.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📚</div>
          <p className="text-muted">Nog geen weken in het archief.</p>
        </div>
      )}

      {menus && menus.length > 0 && (
        <>
          <label className="relative block mb-6">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Wanneer aten we…"
              aria-label="Zoek een gerecht in het archief"
              className="w-full pl-11 pr-4 py-3 bg-surface border border-line-soft rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-warmth-400" />
          </label>

          {filtered.length === 0 && (
            <p className="text-center text-muted py-8">Geen week met „{query.trim()}”.</p>
          )}

          {byYear.map(([year, items]) => (
            <section key={year} className="mb-8">
              <h2 className="font-bold text-xs tracking-[0.2em] text-accent mb-3 uppercase">{year}</h2>
              <div className="space-y-3">
                {items.map(({ menu, days }) => (
                  <WeekCard
                    key={menu.id}
                    menu={menu}
                    days={days}
                    open={!!needle || openIds.has(menu.id)}
                    onToggle={() => toggle(menu.id)}
                    onRestore={() => handleRestore(menu)}
                    onDelete={() => handleDelete(menu)}
                    busy={busyId === menu.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
