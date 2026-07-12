import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Search, X, Heart } from 'lucide-react';
import { api, Recipe, Menu, safeJsonParse } from '../lib/api';
import { useMenus } from '../hooks/useMenu';

// Menu week runs Thursday through Wednesday
const DAY_ORDER = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'];

function feedbackSummary(recipe: Recipe): string | null {
  const parts: string[] = [];
  if (recipe.feedback_lekker > 0) parts.push(`${recipe.feedback_lekker}× lekker`);
  if (recipe.feedback_minder > 0) parts.push(`${recipe.feedback_minder}× minder`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function ComposeMenu() {
  const navigate = useNavigate();
  const { menus } = useMenus();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [slots, setSlots] = useState<Record<string, Recipe | null>>(
    Object.fromEntries(DAY_ORDER.map((d) => [d, null])),
  );
  const [pickerDay, setPickerDay] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [weekNumber, setWeekNumber] = useState('');
  const [yearInput, setYearInput] = useState('');
  const [targetWeek, setTargetWeek] = useState<{ weekNumber: number; year: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTargetWeek().then(setTargetWeek).catch(() => {});
    api.getRecipes().then(setRecipes).catch(() => {});
  }, []);

  const displayWeek = weekNumber ? parseInt(weekNumber) : targetWeek?.weekNumber;
  const displayYear = yearInput ? parseInt(yearInput) : targetWeek?.year;

  const existingMenu = useMemo(
    () => menus.find((m: Menu) => m.week_number === displayWeek && m.year === displayYear),
    [menus, displayWeek, displayYear],
  );

  const pickerRecipes = useMemo(() => {
    const q = pickerSearch.toLowerCase();
    return recipes
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => (b.favorite - a.favorite) || (b.times_used - a.times_used));
  }, [recipes, pickerSearch]);

  const filledDays = DAY_ORDER.filter((d) => slots[d]);

  async function handleCompose() {
    setSaving(true);
    setError(null);
    try {
      await api.composeMenu({
        days: filledDays.map((d) => ({ day_name: d, recipe_id: slots[d]!.id })),
        weekNumber: weekNumber ? parseInt(weekNumber) : undefined,
        year: yearInput ? parseInt(yearInput) : undefined,
      });
      navigate('/admin');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to="/admin" className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
        <ArrowLeft size={16} /> terug naar beheer
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-8">Menu samenstellen</h1>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Week</label>
            <input type="number" value={weekNumber} onChange={(e) => setWeekNumber(e.target.value)}
              placeholder={targetWeek ? String(targetWeek.weekNumber) : 'Auto'}
              className="w-full p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Jaar</label>
            <input type="number" value={yearInput} onChange={(e) => setYearInput(e.target.value)}
              placeholder={targetWeek ? String(targetWeek.year) : 'Auto'}
              className="w-full p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400" />
          </div>
        </div>

        {existingMenu && (
          <p className="text-xs text-red-500">
            Er bestaat al een menu voor week {displayWeek} — samenstellen vervangt dit menu
            (afgevinkte boodschappen gaan verloren).
          </p>
        )}
        {!existingMenu && displayWeek && displayYear && (
          <p className="text-xs text-muted">
            Menu wordt opgeslagen als week {displayWeek}, {displayYear}. Direct actief.
            De boodschappenlijst wordt automatisch berekend uit de recepten.
          </p>
        )}
      </div>

      <div className="space-y-3 mb-6">
        {DAY_ORDER.map((day) => {
          const recipe = slots[day];
          return (
            <div key={day} className="bg-white rounded-3xl p-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-[0.2em] text-accent uppercase w-24 flex-shrink-0">
                  {day}
                </span>
                {recipe ? (
                  <div className="flex items-center gap-2 flex-1 justify-between min-w-0">
                    <span className="font-bold text-sm truncate">{recipe.name}</span>
                    <button onClick={() => setSlots((s) => ({ ...s, [day]: null }))}
                      aria-label={`Verwijder recept voor ${day}`}
                      className="p-1 text-gray-300 hover:text-red-400 flex-shrink-0">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => { setPickerDay(pickerDay === day ? null : day); setPickerSearch(''); }}
                    className="text-sm text-warmth-500 font-medium hover:underline">
                    {pickerDay === day ? 'Sluit' : '+ Kies recept'}
                  </button>
                )}
              </div>

              {pickerDay === day && !recipe && (
                <div className="mt-4 border-t border-gray-100 pt-4">
                  <div className="relative mb-3">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input type="text" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Zoek in receptenboek..." autoFocus
                      className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400" />
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {pickerRecipes.length === 0 ? (
                      <p className="text-xs text-muted p-2">Geen recepten gevonden.</p>
                    ) : pickerRecipes.map((r) => {
                      const summary = feedbackSummary(r);
                      const tags = safeJsonParse<string[]>(r.tags, []);
                      return (
                        <button key={r.id}
                          onClick={() => { setSlots((s) => ({ ...s, [day]: r })); setPickerDay(null); }}
                          className="w-full text-left p-3 rounded-xl hover:bg-cream-50 dark:hover:bg-[#252838] transition-colors">
                          <div className="flex items-center gap-2">
                            {r.favorite ? <Heart size={12} className="text-warmth-500 fill-warmth-500 flex-shrink-0" /> : null}
                            <span className="font-medium text-sm">{r.name}</span>
                          </div>
                          <div className="flex gap-2 items-center mt-0.5">
                            {tags.slice(0, 2).map((tag) => (
                              <span key={tag} className="text-[10px] text-warmth-600">{tag}</span>
                            ))}
                            <span className="text-[10px] text-muted">{r.times_used}x gebruikt{summary ? ` · ${summary}` : ''}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl mb-6 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      <button onClick={handleCompose} disabled={saving || filledDays.length === 0}
        className="w-full py-4 bg-warmth-500 text-white rounded-2xl font-bold text-lg shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-all disabled:opacity-50">
        {saving
          ? 'Samenstellen...'
          : filledDays.length === 0
            ? 'Kies eerst recepten'
            : `Maak weekmenu (${filledDays.length} ${filledDays.length === 1 ? 'dag' : 'dagen'})`}
      </button>
    </div>
  );
}
