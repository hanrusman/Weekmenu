import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Check, Archive, RotateCcw } from 'lucide-react';
import { api, Recipe, RecipeData, RecipeStatus, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';
import { RatingChips } from './RecipeLibrary';

const STATUS_LABEL: Record<RecipeStatus, string> = {
  goedgekeurd: 'Goedgekeurd',
  concept: 'Concept',
  archief: 'Gearchiveerd',
};

export default function LibraryRecipe() {
  const { id } = useParams();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getRecipe(Number(id)).then(setRecipe).catch((err) => setError((err as Error).message));
  }, [id]);

  async function changeStatus(status: RecipeStatus) {
    if (!recipe) return;
    setBusy(true);
    setError(null);
    try {
      setRecipe(await api.setRecipeStatus(recipe.id, status));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!recipe) {
    return (
      <div className="p-6 pt-16 text-center text-muted">
        {error || 'Laden...'}
        {error && <div><Link to="/recepten" className="text-warmth-500 mt-4 inline-block hover:underline">← recepten</Link></div>}
      </div>
    );
  }

  const data = safeJsonParse<RecipeData>(recipe.recipe_data, { ingredients: [], steps: [] });
  const actions: Array<{ status: RecipeStatus; label: string; icon: typeof Check; primary?: boolean }> = [
    { status: 'goedgekeurd' as const, label: 'Goedkeuren', icon: Check, primary: true },
    { status: 'concept' as const, label: 'Terug naar concept', icon: RotateCcw },
    { status: 'archief' as const, label: 'Archiveren', icon: Archive },
  ].filter((a) => a.status !== recipe.status);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 pb-32">
      <div className="flex items-center justify-between mb-6">
        <Link to={`/recepten?status=${recipe.status}`} className="flex items-center gap-2 text-muted text-sm hover:text-ink transition-colors">
          <ArrowLeft size={16} /> recepten
        </Link>
        <Link to={`/recepten/${recipe.id}/bewerken`} className="flex items-center gap-1.5 text-sm font-bold text-warmth-500 hover:text-warmth-600">
          <Pencil size={14} /> Bewerken
        </Link>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-4 text-sm">
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
          recipe.status === 'goedgekeurd' ? 'bg-green-100 text-green-700'
            : recipe.status === 'archief' ? 'bg-gray-100 text-muted' : 'bg-warmth-400/20 text-warmth-600'
        }`}>
          {STATUS_LABEL[recipe.status]}
        </span>
        {recipe.times_used > 0 && <span className="text-muted">{recipe.times_used}× gepland</span>}
        {recipe.source && !['import', 'weekmenu', 'manual'].includes(recipe.source) && (
          <span className="text-muted">uit {recipe.source.replace(/\.(md|markdown|txt|json)$/i, '')}</span>
        )}
        <RatingChips recipe={recipe} />
      </div>

      <RecipeView
        recipe={data}
        recipeName={recipe.name}
        prepTime={recipe.prep_time_minutes ?? 0}
        costIndex={recipe.cost_index ?? ''}
        mealType={recipe.meal_type ?? ''}
      />

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl mt-6 text-sm">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-3 mt-8">
        {actions.map(({ status, label, icon: Icon, primary }) => (
          <button key={status} onClick={() => changeStatus(status)} disabled={busy}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold transition-colors disabled:opacity-50 ${
              primary
                ? 'bg-warmth-500 text-white shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600'
                : 'bg-white text-ink shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:bg-gray-50'
            }`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
    </div>
  );
}
