import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Wand2 } from 'lucide-react';
import { api, IngredientPreview, RecipeInput } from '../lib/api';
import RecipeEditor from '../components/RecipeEditor';

const EMPTY_RECIPE: RecipeInput = {
  name: '', servings: 4, meal_type: null, prep_time_minutes: null, cost_index: null,
  ingredients: [], steps: [], tip: null, nutrition_per_serving: null,
};

export default function RecipeImport() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parserAvailable, setParserAvailable] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<{ recipe: RecipeInput; preview?: IngredientPreview[] } | null>(null);

  useEffect(() => {
    api.getParserStatus().then((s) => setParserAvailable(s.configured)).catch(() => setParserAvailable(false));
  }, []);

  async function handleParse() {
    setError(null);
    setParsing(true);
    try {
      const { draft: recipe, preview } = await api.parseRecipe(text);
      setDraft({ recipe, preview });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function handleSave(recipe: RecipeInput) {
    const saved = await api.createRecipe(recipe);
    navigate(`/recepten/${saved.id}`, { replace: true });
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      {draft ? (
        <button onClick={() => setDraft(null)} className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
          <ArrowLeft size={16} /> terug naar tekst
        </button>
      ) : (
        <Link to="/recepten" className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
          <ArrowLeft size={16} /> recepten
        </Link>
      )}

      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Recept toevoegen</h1>

      {draft ? (
        <>
          <p className="text-sm text-muted mb-6">
            Controleer het recept. Bij elk ingrediënt zie je of het al bekend is, onder welke naam het op de
            boodschappenlijst komt, en of de hoeveelheid optelt met andere recepten.
          </p>
          <RecipeEditor
            initial={draft.recipe}
            initialPreview={draft.preview}
            onSave={handleSave}
            actions={[
              { label: 'Opslaan als concept', status: 'concept' },
              { label: 'Opslaan en goedkeuren', status: 'goedgekeurd', primary: true },
            ]}
          />
        </>
      ) : (
        <>
          <p className="text-sm text-muted mb-6">
            Plak een recept uit een kookboek, website of notitie. De app haalt er naam, ingrediënten en stappen uit;
            daarna controleer je alles voordat het in de bibliotheek komt.
          </p>
          {parserAvailable === false && (
            <div className="bg-warmth-400/20 p-3 rounded-2xl mb-4 text-sm">
              Recepten inlezen is op deze server niet ingesteld. Je kunt het recept wel met de hand invoeren.
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder={'Romige kikkererwtencurry\nVoor 4 personen\n\n2 uien, gesnipperd\n2 blikken kikkererwten, uitgelekt\n…'}
            className="w-full p-4 border border-gray-200 rounded-2xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-warmth-400"
            disabled={parsing}
          />
          {error && <div className="bg-red-50 text-red-600 p-3 rounded-2xl mt-4 text-sm">{error}</div>}
          <div className="flex flex-col sm:flex-row gap-3 mt-4">
            <button
              onClick={handleParse}
              disabled={parsing || !text.trim() || parserAvailable === false}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-warmth-500 text-white rounded-2xl font-bold shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-colors disabled:opacity-50"
            >
              <Wand2 size={18} className={parsing ? 'animate-pulse' : ''} />
              {parsing ? 'Recept lezen...' : 'Lees recept'}
            </button>
            <button
              onClick={() => setDraft({ recipe: EMPTY_RECIPE })}
              disabled={parsing}
              className="flex-1 py-3.5 bg-white text-ink rounded-2xl font-bold shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Zelf invullen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
