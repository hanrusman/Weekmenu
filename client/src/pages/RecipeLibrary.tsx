import { useState, useEffect } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { api, Recipe, RecipeData, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';

export default function RecipeLibrary() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadRecipes(); }, []);

  async function loadRecipes(query?: string) {
    setLoading(true);
    try {
      setRecipes(await api.getRecipes(query));
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  function handleSearch() {
    loadRecipes(search || undefined);
  }

  if (selected) {
    const recipeData = safeJsonParse<RecipeData>(selected.recipe_data, {
      ingredients: [], steps: [],
      nutrition_per_serving: { calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 },
    });
    const tags = safeJsonParse<string[]>(selected.tags, []);

    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 pb-32">
        <button onClick={() => setSelected(null)}
          className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
          <ArrowLeft size={16} /> terug naar bibliotheek
        </button>

        <RecipeView recipe={recipeData} recipeName={selected.name} prepTime={0} costIndex="" />

        {tags.length > 0 && (
          <div className="flex gap-2 mt-6 flex-wrap">
            {tags.map((tag) => (
              <span key={tag} className="text-xs px-3 py-1 bg-warmth-400/20 rounded-full text-warmth-600 font-medium">
                {tag}
              </span>
            ))}
          </div>
        )}

        <p className="text-sm text-muted mt-4">
          {selected.times_used}x gebruikt
          {selected.source && ` · Bron: ${selected.source}`}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
        Recepten
      </h1>

      <div className="flex gap-2 mb-8">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Zoek recepten..."
            className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-2xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-warmth-400"
          />
        </div>
        <button onClick={handleSearch}
          className="px-5 bg-warmth-500 text-white rounded-2xl text-sm font-bold hover:bg-warmth-600 transition-colors">
          Zoek
        </button>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted">Laden...</div>
      ) : recipes.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📖</div>
          <p className="text-muted">
            Nog geen recepten. Recepten worden automatisch toegevoegd vanuit je weekmenu's.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {recipes.map((recipe) => {
            const tags = safeJsonParse<string[]>(recipe.tags, []);
            return (
              <button key={recipe.id} onClick={() => setSelected(recipe)}
                className="w-full text-left p-5 bg-white rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow">
                <h3 className="font-bold tracking-tight mb-2">{recipe.name}</h3>
                <div className="flex gap-2 flex-wrap">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 bg-warmth-400/20 rounded-full text-warmth-600 font-bold uppercase tracking-wide">
                      {tag}
                    </span>
                  ))}
                  <span className="text-xs text-muted">{recipe.times_used}x</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
