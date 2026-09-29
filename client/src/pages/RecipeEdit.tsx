import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, Recipe, RecipeData, RecipeInput, safeJsonParse } from '../lib/api';
import RecipeEditor from '../components/RecipeEditor';

function toInput(recipe: Recipe): RecipeInput {
  const data = safeJsonParse<RecipeData>(recipe.recipe_data, { ingredients: [], steps: [] });
  return {
    name: recipe.name,
    status: recipe.status,
    servings: data.servings ?? recipe.servings ?? 4,
    meal_type: recipe.meal_type,
    prep_time_minutes: recipe.prep_time_minutes,
    cost_index: recipe.cost_index,
    ingredients: data.ingredients,
    steps: data.steps,
    tip: data.tip ?? null,
    nutrition_per_serving: data.nutrition_per_serving ?? null,
  };
}

export default function RecipeEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getRecipe(Number(id)).then(setRecipe).catch((err) => setError((err as Error).message));
  }, [id]);

  async function handleSave(input: RecipeInput) {
    if (!recipe) return;
    await api.updateRecipe(recipe.id, input);
    navigate(`/recepten/${recipe.id}`, { replace: true });
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to={`/recepten/${id}`} className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
        <ArrowLeft size={16} /> terug
      </Link>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Recept bewerken</h1>
      {!recipe ? (
        <p className="text-center py-8 text-muted">{error || 'Laden...'}</p>
      ) : (
        <RecipeEditor
          initial={toInput(recipe)}
          onSave={handleSave}
          actions={[{ label: 'Opslaan', primary: true }]}
        />
      )}
    </div>
  );
}
