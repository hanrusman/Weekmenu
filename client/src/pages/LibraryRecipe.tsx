import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Check, Archive, RotateCcw, ImagePlus } from 'lucide-react';
import { api, Recipe, RecipeData, RecipeStatus, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';
import StatusUndo, { ReviewState } from '../components/StatusUndo';
import { RatingChips } from './RecipeLibrary';
import { recipeImageUrl } from '../lib/mealImages';

const STATUS_LABEL: Record<RecipeStatus, string> = {
  goedgekeurd: 'Goedgekeurd',
  concept: 'Concept',
  archief: 'Gearchiveerd',
};

/**
 * Where the recipe's own picture stands. Recipes without one are queued by
 * themselves (archived ones only on request); the script on the Mac makes them.
 */
function ImageStatus({ recipe, busy, onRequest }: { recipe: Recipe; busy: boolean; onRequest: () => void }) {
  const button = (label: string) => (
    <button onClick={onRequest} disabled={busy}
      className="inline-flex items-center gap-1.5 font-bold text-warmth-500 hover:text-warmth-600 disabled:opacity-50">
      <ImagePlus size={14} /> {label}
    </button>
  );
  if (recipe.image_error) {
    return (
      <p className="text-red-600">
        Plaatje maken mislukt: {recipe.image_error} {button('Opnieuw proberen')}
      </p>
    );
  }
  if (recipe.image_requested_at || (!recipe.image_version && recipe.status !== 'archief')) {
    return <p className="text-muted">In de wachtrij voor {recipe.image_version ? 'een nieuw plaatje' : 'een plaatje'}</p>;
  }
  return button(recipe.image_version ? 'Nieuw plaatje' : 'Plaatje maken');
}

const ACTIONS: Array<{ status: RecipeStatus; label: string; icon: typeof Check; primary?: boolean }> = [
  { status: 'goedgekeurd', label: 'Goedkeuren', icon: Check, primary: true },
  { status: 'concept', label: 'Terug naar concept', icon: RotateCcw },
  { status: 'archief', label: 'Archiveren', icon: Archive },
];

export default function LibraryRecipe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const change = (useLocation().state as ReviewState | null)?.change;
  // The recipe and the ids of the recipes with its status (in library order,
  // where "next" comes from) load together: neither is usable without the other
  const [loaded, setLoaded] = useState<{ recipe: Recipe; queue: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);

  useEffect(() => {
    let current = true; // a response for an id we already left is ignored
    window.scrollTo(0, 0);
    setLoaded(null);
    setError(null);
    (async () => {
      try {
        const recipe = await api.getRecipe(Number(id));
        const { recipes } = await api.getRecipes({ status: recipe.status });
        if (current) setLoaded({ recipe, queue: recipes.map((r) => r.id) });
      } catch (err) {
        if (current) setError((err as Error).message);
      }
    })();
    return () => { current = false; };
  }, [id]);

  // Until the page has loaded what the URL asks for, it shows nothing to act on
  const recipe = loaded && loaded.recipe.id === Number(id) ? loaded.recipe : null;
  const queue = recipe ? loaded!.queue : [];

  /** Change the status and move straight on to the next recipe that still has the old one. */
  async function changeStatus(status: RecipeStatus) {
    if (!recipe) return;
    setBusy(true);
    setError(null);
    try {
      await api.setRecipeStatus(recipe.id, status);
      const position = queue.indexOf(recipe.id);
      const rest = queue.filter((other) => other !== recipe.id);
      // The one that came after it, or from the top when this was the last
      const nextId = (position >= 0 ? rest[position] : undefined) ?? rest[0];
      const state: ReviewState = { change: { id: recipe.id, name: recipe.name, from: recipe.status, to: status } };
      navigate(nextId ? `/recepten/${nextId}` : `/recepten?status=${recipe.status}`, { state });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function requestImage() {
    if (!recipe) return;
    setImageBusy(true);
    setError(null);
    try {
      const updated = await api.requestRecipeImage(recipe.id);
      setLoaded((l) => (l && l.recipe.id === updated.id ? { ...l, recipe: updated } : l));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImageBusy(false);
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
  const actions = ACTIONS.filter((a) => a.status !== recipe.status);
  const position = queue.indexOf(recipe.id);

  const buttons = (compact: boolean) => actions.map(({ status, label, icon: Icon, primary }) => (
    <button key={status} onClick={() => changeStatus(status)} disabled={busy}
      className={`flex-1 flex items-center justify-center gap-2 rounded-2xl font-bold transition-colors disabled:opacity-50 ${
        compact ? 'py-2.5 text-sm' : 'py-3.5'
      } ${
        primary
          ? 'bg-warmth-500 text-white shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600'
          : 'bg-white text-ink shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:bg-gray-50'
      }`}>
      <Icon size={16} /> {label}
    </button>
  ));

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

      {change && change.id !== recipe.id && <StatusUndo change={change} />}

      <div className="flex items-center gap-3 flex-wrap mb-4 text-sm">
        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
          recipe.status === 'goedgekeurd' ? 'bg-green-100 text-green-700'
            : recipe.status === 'archief' ? 'bg-gray-100 text-muted' : 'bg-warmth-400/20 text-warmth-600'
        }`}>
          {STATUS_LABEL[recipe.status]}
          {position >= 0 && queue.length > 1 && <span className="font-normal"> · {position + 1} van {queue.length}</span>}
        </span>
        {recipe.times_used > 0 && <span className="text-muted">{recipe.times_used}× gepland</span>}
        {recipe.source && !['import', 'weekmenu', 'manual'].includes(recipe.source) && (
          <span className="text-muted">uit {recipe.source.replace(/\.(md|markdown|txt|json)$/i, '')}</span>
        )}
        <RatingChips recipe={recipe} />
      </div>

      <div className="mb-4 text-sm">
        <ImageStatus recipe={recipe} busy={imageBusy} onRequest={requestImage} />
      </div>

      {/* Also at the top, so a long list can be reviewed without scrolling */}
      <div className="flex gap-2 mb-6">{buttons(true)}</div>
      {error && <div role="alert" className="bg-red-50 text-red-600 p-3 rounded-2xl -mt-3 mb-6 text-sm">{error}</div>}

      <RecipeView
        recipe={data}
        recipeName={recipe.name}
        prepTime={recipe.prep_time_minutes ?? 0}
        costIndex={recipe.cost_index ?? ''}
        mealType={recipe.meal_type ?? ''}
        imageSrc={recipeImageUrl(recipe.id, recipe.image_version)}
      />

      {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl mt-6 text-sm">{error}</div>}

      <div className="flex flex-col sm:flex-row gap-3 mt-8">{buttons(false)}</div>
    </div>
  );
}
