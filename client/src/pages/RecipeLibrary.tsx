import { useState, useEffect } from 'react';
import { api, Recipe, RecipeData, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';

export default function RecipeLibrary() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecipes();
  }, []);

  async function loadRecipes(query?: string) {
    setLoading(true);
    try {
      const data = await api.getRecipes(query);
      setRecipes(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  function handleSearch() {
    loadRecipes(search || undefined);
  }

  if (selected) {
    const recipeData = safeJsonParse<RecipeData>(selected.recipe_data, {
      ingredients: [], steps: [], nutrition_per_serving: { calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 },
    });
    const tags = safeJsonParse<string[]>(selected.tags, []);

    return (
      <div className="p-4 max-w-lg mx-auto pt-12 pb-24">
        <button
          onClick={() => setSelected(null)}
          className="text-forest-600 dark:text-forest-500 text-sm mb-4 hover:underline"
        >
          ← terug naar bibliotheek
        </button>

        <RecipeView
          recipe={recipeData}
          recipeName={selected.name}
          prepTime={0}
          costIndex=""
        />

        {tags.length > 0 && (
          <div className="flex gap-2 mt-4 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-xs px-2 py-1 bg-cream-200 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="text-sm text-gray-500 mt-4">
          {selected.times_used}x gebruikt
          {selected.source && ` · Bron: ${selected.source}`}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto pt-12">
      <h1 className="text-2xl font-bold text-forest-700 dark:text-forest-500 mb-4">
        Receptenbibliotheek
      </h1>

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Zoek recepten..."
          className="flex-1 p-3 border rounded-lg text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200"
        />
        <button
          onClick={handleSearch}
          className="px-4 bg-forest-500 text-white rounded-lg text-sm font-medium hover:bg-forest-600"
        >
          Zoek
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">Laden...</div>
      ) : recipes.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">📖</div>
          <p className="text-gray-500 dark:text-gray-400">
            Nog geen recepten. Recepten worden automatisch toegevoegd vanuit je weekmenu's.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {recipes.map((recipe) => {
            const tags = safeJsonParse<string[]>(recipe.tags, []);
            return (
              <button
                key={recipe.id}
                onClick={() => setSelected(recipe)}
                className="w-full text-left p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow"
              >
                <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                  {recipe.name}
                </h3>
                <div className="flex gap-2 mt-1 flex-wrap">
                  {tags.slice(0, 4).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs px-2 py-0.5 bg-cream-200 dark:bg-gray-700 rounded-full text-gray-500 dark:text-gray-400"
                    >
                      {tag}
                    </span>
                  ))}
                  <span className="text-xs text-gray-400">{recipe.times_used}x</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
