import { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Search, Plus, Heart, Link as LinkIcon, Pencil } from 'lucide-react';
import { api, Recipe, RecipeData, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';

function feedbackSummary(recipe: Recipe): string | null {
  const parts: string[] = [];
  if (recipe.feedback_lekker > 0) parts.push(`${recipe.feedback_lekker}× lekker`);
  if (recipe.feedback_ok > 0) parts.push(`${recipe.feedback_ok}× ok`);
  if (recipe.feedback_minder > 0) parts.push(`${recipe.feedback_minder}× minder`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export default function RecipeLibrary() {
  const navigate = useNavigate();
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('alles'); // 'alles' | 'favorieten' | tag
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleToggleFavorite(recipe: Recipe) {
    const next = recipe.favorite ? 0 : 1;
    // Optimistic update; roll back on failure
    setRecipes((rs) => rs.map((r) => (r.id === recipe.id ? { ...r, favorite: next } : r)));
    setSelected((s) => (s?.id === recipe.id ? { ...s, favorite: next } : s));
    try {
      await api.toggleFavorite(recipe.id, Boolean(next));
    } catch {
      setRecipes((rs) => rs.map((r) => (r.id === recipe.id ? { ...r, favorite: recipe.favorite } : r)));
      setSelected((s) => (s?.id === recipe.id ? { ...s, favorite: recipe.favorite } : s));
    }
  }

  async function handleImportUrl() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      const draft = await api.importRecipeUrl(importUrl.trim());
      navigate('/recepten/nieuw', { state: { draft } });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const recipe of recipes) {
      for (const tag of safeJsonParse<string[]>(recipe.tags, [])) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [recipes]);

  const visible = useMemo(() => {
    if (filter === 'alles') return recipes;
    if (filter === 'favorieten') return recipes.filter((r) => r.favorite);
    return recipes.filter((r) => safeJsonParse<string[]>(r.tags, []).includes(filter));
  }, [recipes, filter]);

  if (selected) {
    const recipeData = safeJsonParse<RecipeData>(selected.recipe_data, {
      ingredients: [], steps: [],
      nutrition_per_serving: { calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 },
    });
    const tags = safeJsonParse<string[]>(selected.tags, []);
    const summary = feedbackSummary(selected);

    return (
      <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 pb-32">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => setSelected(null)}
            className="flex items-center gap-2 text-muted text-sm hover:text-ink transition-colors">
            <ArrowLeft size={16} /> terug naar bibliotheek
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => handleToggleFavorite(selected)} aria-label="Favoriet"
              className="p-2 rounded-full hover:bg-gray-50 dark:hover:bg-[#252838] transition-colors">
              <Heart size={20} className={selected.favorite ? 'text-warmth-500 fill-warmth-500' : 'text-gray-300'} />
            </button>
            <Link to={`/recepten/${selected.id}/bewerken`}
              className="flex items-center gap-1 px-3 py-2 text-sm text-warmth-500 font-medium hover:bg-warmth-400/20 rounded-xl transition-colors">
              <Pencil size={14} /> Bewerken
            </Link>
          </div>
        </div>

        <RecipeView recipe={recipeData} recipeName={selected.name} prepTime={selected.prep_time_minutes ?? 0} costIndex={selected.cost_index ?? ''} />

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
          {summary && ` · ${summary}`}
          {selected.source && ` · Bron: ${selected.source}`}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Recepten</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(!showImport)} aria-label="Importeer van URL"
            className="p-3 bg-white border-2 border-warmth-500 text-warmth-500 rounded-2xl hover:bg-warmth-500 hover:text-white transition-all">
            <LinkIcon size={16} />
          </button>
          <Link to="/recepten/nieuw"
            className="flex items-center gap-1 px-4 py-3 bg-warmth-500 text-white rounded-2xl text-sm font-bold hover:bg-warmth-600 transition-colors shadow-[0_10px_30px_rgba(242,153,74,0.3)]">
            <Plus size={16} /> Nieuw
          </Link>
        </div>
      </div>

      {showImport && (
        <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
          <label className="block text-xs text-muted mb-1">Importeer een recept van een website</label>
          <div className="flex gap-2">
            <input type="url" value={importUrl} onChange={(e) => setImportUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleImportUrl()}
              placeholder="https://www.ah.nl/allerhande/recept/..."
              className="flex-1 p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400" />
            <button onClick={handleImportUrl} disabled={importing || !importUrl.trim()}
              className="px-5 bg-warmth-500 text-white rounded-2xl text-sm font-bold hover:bg-warmth-600 transition-colors disabled:opacity-50">
              {importing ? 'Ophalen...' : 'Importeer'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl mb-6 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      <div className="flex gap-2 mb-4">
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

      <div className="flex gap-2 mb-8 flex-wrap">
        {['alles', 'favorieten', ...allTags].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
              filter === f
                ? 'bg-warmth-500 text-white'
                : 'bg-warmth-400/20 text-warmth-600 hover:bg-warmth-400/40'
            }`}>
            {f === 'favorieten' ? '♥ Favorieten' : f === 'alles' ? 'Alles' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted">Laden...</div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📖</div>
          <p className="text-muted">
            {filter === 'favorieten'
              ? 'Nog geen favorieten. Tik op het hartje bij een recept.'
              : 'Nog geen recepten. Voeg zelf een recept toe of importeer er één van een website.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {visible.map((recipe) => {
            const tags = safeJsonParse<string[]>(recipe.tags, []);
            const summary = feedbackSummary(recipe);
            return (
              <button key={recipe.id} onClick={() => setSelected(recipe)}
                className="w-full text-left p-5 bg-white rounded-3xl shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-md transition-shadow relative">
                <span
                  role="button"
                  aria-label={recipe.favorite ? 'Verwijder favoriet' : 'Markeer als favoriet'}
                  onClick={(e) => { e.stopPropagation(); handleToggleFavorite(recipe); }}
                  className="absolute top-4 right-4 p-1">
                  <Heart size={18} className={recipe.favorite ? 'text-warmth-500 fill-warmth-500' : 'text-gray-300 hover:text-warmth-400'} />
                </span>
                <h3 className="font-bold tracking-tight mb-2 pr-8">{recipe.name}</h3>
                <div className="flex gap-2 flex-wrap items-center">
                  {tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 bg-warmth-400/20 rounded-full text-warmth-600 font-bold uppercase tracking-wide">
                      {tag}
                    </span>
                  ))}
                  <span className="text-xs text-muted">{recipe.times_used}x</span>
                </div>
                {summary && (
                  <p className="text-xs text-muted mt-2">{summary}</p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
