import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api, MenuDay, RecipeData, Feedback, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';
import { recipeImageUrl } from '../lib/mealImages';
import { StarInput } from '../components/Stars';
import Button from '../components/Button';


export default function RecipeDetail() {
  const { dayId } = useParams();
  const navigate = useNavigate();
  const [day, setDay] = useState<MenuDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);

  useEffect(() => {
    const id = Number(dayId);
    if (!dayId || !Number.isInteger(id) || id <= 0) {
      setError('Ongeldig dag ID');
      setLoading(false);
      return;
    }

    api.getDay(id)
      .then((d) => {
        setDay(d);
        api.getDayFeedback(d.menu_id, d.id)
          .then((fb) => {
            if (fb) {
              setFeedback(fb);
              setSelectedRating(fb.stars);
              setFeedbackNotes(fb.notes || '');
            }
          })
          .catch(() => {});
      })
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
      <div className="p-6 pt-16 text-center">
        <p className="text-muted">{error || 'Recept niet gevonden'}</p>
        <button onClick={() => navigate(-1)} className="text-brand mt-4 hover:underline">
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

  async function handleSaveFeedback() {
    if (!day || !selectedRating) return;
    setSavingFeedback(true);
    try {
      const fb = await api.saveFeedback(day.menu_id, day.id, selectedRating, feedbackNotes || undefined);
      setFeedback(fb);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingFeedback(false);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 pb-32">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors"
      >
        <ArrowLeft size={16} />
        terug
      </button>

      <RecipeView
        recipe={recipe}
        recipeName={day.recipe_name}
        prepTime={day.prep_time_minutes}
        costIndex={day.cost_index}
        mealType={day.meal_type}
        imageSrc={recipeImageUrl(day.recipe_id, day.recipe_image_version)}
      />

      {day.status !== 'completed' && (
        <Button block size="lg" onClick={handleComplete} disabled={completing} className="mt-10">
          {completing ? 'Bezig...' : 'Klaar — maaltijd gehad'}
        </Button>
      )}

      {day.status === 'completed' && (
        <div className="mt-10 bg-surface rounded-3xl p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
          <h3 className="font-bold text-sm tracking-wide text-accent mb-4 uppercase text-center">
            Hoe was het?
          </h3>

          <div className="mb-5">
            <StarInput value={selectedRating} onChange={setSelectedRating} size={36} />
          </div>

          <textarea
            value={feedbackNotes}
            onChange={(e) => setFeedbackNotes(e.target.value)}
            onFocus={(e) => {
              const el = e.currentTarget;
              setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
            }}
            placeholder="Opmerkingen (optioneel)..."
            className="w-full p-3 border border-line rounded-2xl text-sm mb-4 resize-none bg-sunken focus:outline-none focus:ring-2 focus:ring-warmth-400"
            rows={2}
            maxLength={500}
          />

          <Button block onClick={handleSaveFeedback} disabled={!selectedRating || savingFeedback}>
            {savingFeedback ? 'Opslaan...' : feedback ? 'Feedback bijwerken' : 'Feedback opslaan'}
          </Button>

          {feedback && !savingFeedback && (
            <p className="mt-3 text-center text-xs text-success font-medium">
              Feedback opgeslagen
            </p>
          )}
        </div>
      )}
    </div>
  );
}
