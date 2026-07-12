import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api, RecipeData, RecipeDraft, safeJsonParse } from '../lib/api';

// Mirror of PRODUCT_GROUPS in server/services/ingredients.ts
const PRODUCT_GROUPS = [
  'groenten', 'fruit', 'vis', 'vlees', 'zuivel', 'brood',
  'kruiden', 'droogwaren', 'olie', 'sauzen', 'diepvries', 'overig',
];

const COST_OPTIONS = ['€', '€€', '€€€'];

interface IngredientRow {
  name: string;
  amount: string;
  unit: string;
  product_group: string;
}

const INPUT_CLASS = 'w-full p-3 border border-gray-200 rounded-2xl text-sm bg-cream-50 focus:outline-none focus:ring-2 focus:ring-warmth-400';

const EMPTY_INGREDIENT: IngredientRow = { name: '', amount: '', unit: '', product_group: 'overig' };

export default function RecipeForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const draft = (location.state as { draft?: RecipeDraft } | null)?.draft;
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [servings, setServings] = useState('4');
  const [prepTime, setPrepTime] = useState('');
  const [costIndex, setCostIndex] = useState('€€');
  const [tagsInput, setTagsInput] = useState('');
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ ...EMPTY_INGREDIENT }]);
  const [steps, setSteps] = useState<string[]>(['']);
  const [nutrition, setNutrition] = useState({ calories: '0', protein_g: '0', fiber_g: '0', iron_mg: '0' });
  const [tip, setTip] = useState('');
  const [source, setSource] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  function fillFromRecipeData(recipeName: string, data: RecipeData, tags: string[], recipeSource?: string) {
    setName(recipeName);
    setServings(String(data.servings ?? 4));
    setTagsInput(tags.join(', '));
    setIngredients(data.ingredients.length > 0
      ? data.ingredients.map((ing) => ({
          name: ing.name,
          amount: String(ing.amount ?? ''),
          unit: ing.unit,
          product_group: PRODUCT_GROUPS.includes(ing.product_group) ? ing.product_group : 'overig',
        }))
      : [{ ...EMPTY_INGREDIENT }]);
    setSteps(data.steps.length > 0 ? data.steps : ['']);
    setNutrition({
      calories: String(data.nutrition_per_serving?.calories ?? 0),
      protein_g: String(data.nutrition_per_serving?.protein_g ?? 0),
      fiber_g: String(data.nutrition_per_serving?.fiber_g ?? 0),
      iron_mg: String(data.nutrition_per_serving?.iron_mg ?? 0),
    });
    setTip(data.tip ?? '');
    if (recipeSource) setSource(recipeSource);
  }

  useEffect(() => {
    if (draft) {
      fillFromRecipeData(draft.name, draft.recipe_data, draft.tags, draft.source);
      setWarnings(draft.warnings);
      return;
    }
    if (!id) return;
    api.getRecipe(Number(id))
      .then((recipe) => {
        const data = safeJsonParse<RecipeData>(recipe.recipe_data, {
          ingredients: [], steps: [],
          nutrition_per_serving: { calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 },
        });
        fillFromRecipeData(recipe.name, data, safeJsonParse<string[]>(recipe.tags, []));
        if (recipe.prep_time_minutes != null) setPrepTime(String(recipe.prep_time_minutes));
        if (recipe.cost_index) setCostIndex(recipe.cost_index);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function updateIngredient(index: number, field: keyof IngredientRow, value: string) {
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function buildRecipeData(): RecipeData {
    return {
      servings: parseInt(servings) || 4,
      ingredients: ingredients
        .filter((ing) => ing.name.trim())
        .map((ing) => ({
          name: ing.name.trim(),
          amount: ing.amount.trim(),
          unit: ing.unit.trim(),
          product_group: ing.product_group,
        })),
      steps: steps.map((s) => s.trim()).filter(Boolean),
      nutrition_per_serving: {
        calories: parseFloat(nutrition.calories) || 0,
        protein_g: parseFloat(nutrition.protein_g) || 0,
        fiber_g: parseFloat(nutrition.fiber_g) || 0,
        iron_mg: parseFloat(nutrition.iron_mg) || 0,
      },
      ...(tip.trim() ? { tip: tip.trim() } : {}),
    };
  }

  async function handleSave() {
    if (!name.trim()) { setError('Naam is verplicht'); return; }
    const recipeData = buildRecipeData();
    if (recipeData.ingredients.length === 0) { setError('Voeg minimaal één ingrediënt toe'); return; }
    if (recipeData.steps.length === 0) { setError('Voeg minimaal één stap toe'); return; }

    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      recipe_data: recipeData,
      tags: tagsInput.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      ...(prepTime ? { prep_time_minutes: parseInt(prepTime) } : {}),
      cost_index: costIndex,
      ...(source ? { source } : {}),
    };
    try {
      if (isEdit) {
        await api.updateRecipe(Number(id), payload);
      } else {
        await api.createRecipe(payload);
      }
      navigate('/recepten');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || !window.confirm('Weet je zeker dat je dit recept wilt verwijderen?')) return;
    try {
      await api.deleteRecipe(Number(id));
      navigate('/recepten');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted text-sm">Laden...</div>;
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to="/recepten" className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
        <ArrowLeft size={16} /> terug naar bibliotheek
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
        {isEdit ? 'Recept bewerken' : 'Nieuw recept'}
      </h1>

      {warnings.length > 0 && (
        <div className="bg-warmth-400/30 rounded-2xl p-4 mb-6 text-sm">
          {warnings.map((w) => <p key={w}>⚠️ {w}</p>)}
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-2xl mb-6 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-bold">x</button>
        </div>
      )}

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <label className="block text-xs text-muted mb-1">Naam</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Pasta pesto met courgette" className={`${INPUT_CLASS} mb-4`} />

        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Porties</label>
            <input type="number" min="1" value={servings} onChange={(e) => setServings(e.target.value)} className={INPUT_CLASS} />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Bereidingstijd (min)</label>
            <input type="number" min="0" value={prepTime} onChange={(e) => setPrepTime(e.target.value)}
              placeholder="30" className={INPUT_CLASS} />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-muted mb-1">Kosten</label>
            <select value={costIndex} onChange={(e) => setCostIndex(e.target.value)} className={INPUT_CLASS}>
              {COST_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <label className="block text-xs text-muted mb-1">Tags (komma-gescheiden)</label>
        <input type="text" value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
          placeholder="pasta, vegetarisch" className={INPUT_CLASS} />
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <h2 className="font-bold text-sm tracking-wide text-accent uppercase mb-4">Ingrediënten</h2>
        {ingredients.map((ing, i) => (
          <div key={i} className="flex gap-2 mb-2 items-center">
            <input type="text" value={ing.amount} onChange={(e) => updateIngredient(i, 'amount', e.target.value)}
              placeholder="400" aria-label="Hoeveelheid" className={`${INPUT_CLASS} !w-20`} />
            <input type="text" value={ing.unit} onChange={(e) => updateIngredient(i, 'unit', e.target.value)}
              placeholder="g" aria-label="Eenheid" className={`${INPUT_CLASS} !w-20`} />
            <input type="text" value={ing.name} onChange={(e) => updateIngredient(i, 'name', e.target.value)}
              placeholder="penne" aria-label="Ingrediënt" className={`${INPUT_CLASS} flex-1`} />
            <select value={ing.product_group} onChange={(e) => updateIngredient(i, 'product_group', e.target.value)}
              aria-label="Productgroep" className={`${INPUT_CLASS} !w-32`}>
              {PRODUCT_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <button onClick={() => setIngredients((rows) => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
              aria-label="Verwijder ingrediënt" className="p-2 text-gray-300 hover:text-red-400 transition-colors">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button onClick={() => setIngredients((rows) => [...rows, { ...EMPTY_INGREDIENT }])}
          className="flex items-center gap-1 text-sm text-warmth-500 hover:underline font-medium mt-2">
          <Plus size={16} /> Ingrediënt
        </button>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <h2 className="font-bold text-sm tracking-wide text-accent uppercase mb-4">Bereiding</h2>
        {steps.map((step, i) => (
          <div key={i} className="flex gap-2 mb-2 items-start">
            <span className="w-7 h-7 mt-2 flex items-center justify-center bg-warmth-500 text-white rounded-full text-xs font-bold flex-shrink-0">
              {i + 1}
            </span>
            <textarea value={step} onChange={(e) => setSteps((s) => s.map((v, j) => (j === i ? e.target.value : v)))}
              placeholder="Kook de pasta" rows={2} aria-label={`Stap ${i + 1}`}
              className={`${INPUT_CLASS} resize-none`} />
            <button onClick={() => setSteps((s) => s.length > 1 ? s.filter((_, j) => j !== i) : s)}
              aria-label="Verwijder stap" className="p-2 mt-2 text-gray-300 hover:text-red-400 transition-colors">
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        <button onClick={() => setSteps((s) => [...s, ''])}
          className="flex items-center gap-1 text-sm text-warmth-500 hover:underline font-medium mt-2">
          <Plus size={16} /> Stap
        </button>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <h2 className="font-bold text-sm tracking-wide text-accent uppercase mb-4">Voedingswaarden per portie</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            ['calories', 'Calorieën'],
            ['protein_g', 'Eiwit (g)'],
            ['fiber_g', 'Vezels (g)'],
            ['iron_mg', 'IJzer (mg)'],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="block text-xs text-muted mb-1">{label}</label>
              <input type="number" min="0" step="0.1" value={nutrition[key]}
                onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))} className={INPUT_CLASS} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-6">
        <label className="block text-xs text-muted mb-1">Tip (optioneel)</label>
        <textarea value={tip} onChange={(e) => setTip(e.target.value)} rows={2}
          placeholder="Lekker met geraspte parmezaan" className={`${INPUT_CLASS} resize-none`} />
      </div>

      <button onClick={handleSave} disabled={saving}
        className="w-full py-4 bg-warmth-500 text-white rounded-2xl font-bold text-lg shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-all disabled:opacity-50">
        {saving ? 'Opslaan...' : isEdit ? 'Wijzigingen opslaan' : 'Recept opslaan'}
      </button>

      {isEdit && (
        <button onClick={handleDelete}
          className="w-full py-3 mt-3 bg-white border-2 border-red-300 text-red-500 rounded-2xl font-bold hover:bg-red-50 transition-all">
          Verwijder recept
        </button>
      )}
    </div>
  );
}
