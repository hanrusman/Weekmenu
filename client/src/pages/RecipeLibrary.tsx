import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Search, Plus, Clock } from 'lucide-react';
import { api, Recipe, RecipeStatus } from '../lib/api';
import StatusUndo, { ReviewState } from '../components/StatusUndo';

const TABS: Array<{ status: RecipeStatus; label: string; empty: string }> = [
  { status: 'goedgekeurd', label: 'Goedgekeurd', empty: 'Nog geen goedgekeurde recepten. Keur recepten goed vanuit Concept.' },
  { status: 'concept', label: 'Concept', empty: 'Geen concepten. Nieuwe recepten uit weekmenu\'s en imports komen hier binnen.' },
  { status: 'archief', label: 'Archief', empty: 'Het archief is leeg.' },
];

export function RatingChips({ recipe }: { recipe: Pick<Recipe, 'rating_lekker' | 'rating_ok' | 'rating_minder'> }) {
  const chips = [
    { emoji: '😋', count: recipe.rating_lekker, label: 'lekker' },
    { emoji: '🙂', count: recipe.rating_ok, label: 'ok' },
    { emoji: '😕', count: recipe.rating_minder, label: 'minder' },
  ].filter((c) => c.count > 0);
  if (chips.length === 0) return null;
  return (
    <span className="flex gap-2 text-xs">
      {chips.map((c) => (
        <span key={c.label} title={`${c.count}× ${c.label}`}>{c.emoji} {c.count}</span>
      ))}
    </span>
  );
}

export default function RecipeLibrary() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Set when the last recipe of a status was just reviewed
  const change = (useLocation().state as ReviewState | null)?.change;
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [counts, setCounts] = useState<Record<RecipeStatus, number> | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requested = searchParams.get('status') as RecipeStatus | null;
  // Without a choice, open on approved recipes, or concepts while there are none yet
  const status: RecipeStatus = requested && TABS.some((t) => t.status === requested)
    ? requested
    : counts && counts.goedgekeurd === 0 ? 'concept' : 'goedgekeurd';

  useEffect(() => {
    setLoading(true);
    api.getRecipes({ status })
      .then((result) => {
        setRecipes(result.recipes);
        setCounts(result.counts);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [status]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? recipes.filter((r) => r.name.toLowerCase().includes(q)) : recipes;
  }, [recipes, search]);

  const tab = TABS.find((t) => t.status === status)!;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Recepten</h1>
        <Link to="/ingredienten" className="text-sm font-bold text-warmth-500 hover:text-warmth-600 transition-colors">
          Ingrediënten beheren →
        </Link>
      </div>

      {change && <StatusUndo change={change} />}

      <div className="flex gap-2 mb-4">
        {TABS.map((t) => (
          <button
            key={t.status}
            onClick={() => setSearchParams({ status: t.status }, { replace: true })}
            className={`flex-1 py-2.5 px-3 rounded-full text-sm font-bold transition-colors ${
              status === t.status
                ? 'bg-warmth-500 text-white shadow-[0_4px_15px_rgba(242,153,74,0.3)]'
                : 'bg-white text-muted shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
            }`}
          >
            {t.label}{counts && <span className="ml-1 opacity-70">{counts[t.status]}</span>}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-6">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek recepten..."
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-warmth-400"
          />
        </div>
        <Link to="/recepten/nieuw"
          className="flex items-center gap-1.5 px-4 bg-warmth-500 text-white rounded-2xl text-sm font-bold hover:bg-warmth-600 transition-colors">
          <Plus size={16} /> Recept
        </Link>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl mb-4 text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-8 text-muted">Laden...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📖</div>
          <p className="text-muted">{search ? 'Geen recepten gevonden.' : tab.empty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.map((recipe) => (
            <Link key={recipe.id} to={`/recepten/${recipe.id}`}
              className="block p-5 bg-white rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow">
              <h3 className="font-bold tracking-tight mb-2">{recipe.name}</h3>
              <div className="flex gap-3 flex-wrap items-center text-xs text-muted">
                {recipe.meal_type && (
                  <span className="px-2 py-0.5 bg-warmth-400/20 rounded-full text-warmth-600 font-bold uppercase tracking-wide text-[10px]">
                    {recipe.meal_type}
                  </span>
                )}
                {recipe.prep_time_minutes ? <span className="flex items-center gap-1"><Clock size={12} />{recipe.prep_time_minutes} min</span> : null}
                {recipe.times_used > 0 && <span>{recipe.times_used}× gepland</span>}
                <RatingChips recipe={recipe} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
