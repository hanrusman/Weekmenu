import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, MenuDay, RecipeData } from '../lib/api';
import RecipeView from '../components/RecipeView';

export default function RecipeDetail() {
  const { dayId } = useParams();
  const navigate = useNavigate();
  const [day, setDay] = useState<MenuDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        // We need to find this day — get all menus and search
        const menus = await api.getMenus();
        for (const menu of menus) {
          const full = await api.getMenu(menu.id);
          const found = full.days.find((d) => d.id === Number(dayId));
          if (found) {
            setDay(found);
            break;
          }
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dayId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-4xl animate-cook">🍳</div>
      </div>
    );
  }

  if (!day) {
    return (
      <div className="p-6 pt-12 text-center">
        <p className="text-gray-500">Recept niet gevonden</p>
      </div>
    );
  }

  const recipe: RecipeData = JSON.parse(day.recipe_data);

  async function handleComplete() {
    if (!day) return;
    setCompleting(true);
    try {
      await api.completeDay(day.menu_id, day.id);
      setDay({ ...day, status: 'completed', completed_at: new Date().toISOString() });
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
