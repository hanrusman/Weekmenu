import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, MenuDay, RecipeData, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';

export default function RecipeDetail() {
  const { dayId } = useParams();
  const navigate = useNavigate();
  const [day, setDay] = useState<MenuDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    const id = Number(dayId);
    if (!dayId || !Number.isInteger(id) || id <= 0) {
      setError('Ongeldig dag ID');
      setLoading(false);
      return;
    }

    api.getDay(id)
      .then(setDay)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [dayId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-4xl animate-cook">🍳</div>
      </div>
    );
  }

  if (error || !day) {
    return (
      <div className="p-6 pt-12 text-center">
        <p className="text-gray-500">{error || 'Recept niet gevonden'}</p>
        <button onClick={() => navigate(-1)} className="text-forest-600 dark:text-forest-500 mt-4 hover:underline">
          ← terug
        </button>
      </div>
    );
  }

  const recipe = safeJsonParse<RecipeData>(day.recipe_data, {
    ingredients: [],
    steps: [],
    nutrition_per_serving: { calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 },
  });

  async function handleComplete() {
    if (!day) return;
    setCompleting(true);
    try {
      await api.completeDay(day.menu_id, day.id);
      setDay({ ...day, status: 'completed', completed_at: new Date().toISOString() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="p-4 max-w-lg mx-auto pt-12 pb-24">
      <button
        onClick={() => navigate(-1)}
        className="text-forest-600 dark:text-forest-500 text-sm mb-4 hover:underline"
      >
        ← terug
      </button>

      <RecipeView
        recipe={recipe}
        recipeName={day.recipe_name}
        prepTime={day.prep_time_minutes}
        costIndex={day.cost_index}
      />

      {day.status !== 'completed' && (
        <button
          onClick={handleComplete}
          disabled={completing}
          className="mt-8 w-full py-3 bg-forest-500 text-white rounded-xl font-semibold hover:bg-forest-600 transition-colors disabled:opacity-50"
        >
          {completing ? 'Bezig...' : '✓ Klaar — maaltijd gehad'}
        </button>
      )}

      {day.status === 'completed' && (
        <div className="mt-8 text-center text-green-600 dark:text-green-400 font-medium">
          ✓ Deze maaltijd is afgerond
        </div>
      )}
    </div>
  );
}
