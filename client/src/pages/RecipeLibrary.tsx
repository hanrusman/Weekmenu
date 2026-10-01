import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Search, Plus, Clock } from 'lucide-react';
import { api, Recipe, RecipeStatus } from '../lib/api';
import StatusUndo, { ReviewState } from '../components/StatusUndo';
import MealImage from '../components/MealImage';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import VegetableChip from '../components/VegetableChip';
import MealChip from '../components/MealChip';
import { tooFewVegetables } from '../lib/vegetables';
import { Course, COURSE_LABELS, COURSES, incompleteMeal } from '../lib/courses';

/** A kind of dish to filter on, or recipes whose kind is not known yet. */
type CourseFilter = Course | 'onbekend';

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
  const [onlyFewVegetables, setOnlyFewVegetables] = useState(false);
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [course, setCourse] = useState<CourseFilter | null>(null);
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
    return recipes
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .filter((r) => !course || (r.course ?? 'onbekend') === course)
      .filter((r) => !onlyFewVegetables || tooFewVegetables(r))
      .filter((r) => !onlyIncomplete || incompleteMeal(r));
  }, [recipes, search, course, onlyFewVegetables, onlyIncomplete]);
  const fewVegetables = recipes.filter(tooFewVegetables).length;
  const incomplete = recipes.filter(incompleteMeal).length;
  // The kinds present in this tab, in a fixed order
  const courses = ([...COURSES, 'onbekend'] as CourseFilter[])
    .map((c) => ({ course: c, count: recipes.filter((r) => (r.course ?? 'onbekend') === c).length }))
    .filter((c) => c.count > 0);
  const filtered = Boolean(search || course || onlyFewVegetables || onlyIncomplete);

  const tab = TABS.find((t) => t.status === status)!;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <div className="flex items-baseline justify-between gap-4 mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Recepten</h1>
        <span className="flex flex-col items-end gap-1">
          <Link to="/ingredienten" className="text-sm font-bold text-warmth-500 hover:text-warmth-600 transition-colors">
            Ingrediënten beheren →
          </Link>
          <Link to="/recepten/groente" className="text-sm font-bold text-warmth-500 hover:text-warmth-600 transition-colors">
            Groente aanvullen →
          </Link>
        </span>
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

      {courses.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-4 -mt-3" role="group" aria-label="Soort gerecht">
          {[{ course: null, count: recipes.length }, ...courses].map((c) => (
            <button key={c.course ?? 'alle'} onClick={() => setCourse(c.course)} aria-pressed={course === c.course}
              className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                course === c.course ? 'bg-warmth-500 text-white' : 'bg-white text-muted shadow-[0_2px_10px_rgba(0,0,0,0.04)]'
              }`}>
              {c.course === null ? 'Alle soorten' : c.course === 'onbekend' ? 'Soort onbekend' : COURSE_LABELS[c.course]}
              <span className="ml-1 opacity-70">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {(fewVegetables > 0 || incomplete > 0) && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm mb-4">
          {fewVegetables > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlyFewVegetables} onChange={(e) => setOnlyFewVegetables(e.target.checked)} />
              Alleen te weinig groente <span className="text-muted">({fewVegetables})</span>
            </label>
          )}
          {incomplete > 0 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} />
              Alleen geen hele maaltijd <span className="text-muted">({incomplete})</span>
            </label>
          )}
        </div>
      )}

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl mb-4 text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-8 text-muted">Laden...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📖</div>
          <p className="text-muted">{filtered ? 'Geen recepten gevonden.' : tab.empty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.map((recipe) => (
            <Link key={recipe.id} to={`/recepten/${recipe.id}`}
              className="flex items-center gap-4 p-4 bg-white rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow">
              <MealImage
                ownSrc={recipeImageUrl(recipe.id, recipe.image_version)}
                recipeName={recipe.name}
                mealType={recipe.meal_type ?? ''}
                size={64}
                className="block w-16 h-16 flex-shrink-0"
                fallback={
                  <div className="w-16 h-16 flex-shrink-0 rounded-full bg-warmth-400/10 flex items-center justify-center text-2xl">
                    {MEAL_TYPE_EMOJI[recipe.meal_type ?? ''] || '🍽️'}
                  </div>
                }
              />
              <div className="min-w-0">
                <h3 className="font-bold tracking-tight mb-2">{recipe.name}</h3>
                <div className="flex gap-3 flex-wrap items-center text-xs text-muted">
                  {recipe.meal_type && (
                    <span className="px-2 py-0.5 bg-warmth-400/20 rounded-full text-warmth-600 font-bold uppercase tracking-wide text-[10px]">
                      {recipe.meal_type}
                    </span>
                  )}
                  {recipe.prep_time_minutes ? <span className="flex items-center gap-1"><Clock size={12} />{recipe.prep_time_minutes} min</span> : null}
                  <VegetableChip recipe={recipe} />
                  <MealChip recipe={recipe} />
                  {recipe.times_used > 0 && <span>{recipe.times_used}× gepland</span>}
                  <RatingChips recipe={recipe} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
