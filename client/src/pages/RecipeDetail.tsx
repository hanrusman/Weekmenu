import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, MenuDay, RecipeData, Feedback, safeJsonParse } from '../lib/api';
import RecipeView from '../components/RecipeView';

const RATING_OPTIONS = [
  { value: 'lekker', label: 'Lekker', emoji: '😋' },
  { value: 'ok', label: 'OK', emoji: '😐' },
  { value: 'minder', label: 'Minder', emoji: '😕' },
] as const;

export default function RecipeDetail() {
  const { dayId } = useParams();
  const navigate = useNavigate();
  const [day, setDay] = useState<MenuDay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [selectedRating, setSelectedRating] = useState<string | null>(null);
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
        // Load existing feedback
        api.getDayFeedback(d.menu_id, d.id)
          .then((fb) => {
            if (fb) {
              setFeedback(fb);
              setSelectedRating(fb.rating);
              setFeedbackNotes(fb.notes || '');
            }
          })
          .catch(() => { /* no feedback yet */ });
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
          {completing ? 'Bezig...' : 'Klaar — maaltijd gehad'}
        </button>
      )}

      {/* Feedback section - show after completion or if already completed */}
      {day.status === 'completed' && (
        <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Hoe was het?
          </h3>

          <div className="flex gap-2 mb-3">
            {RATING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedRating(opt.value)}
                className={`flex-1 py-3 rounded-lg text-center transition-all ${
                  selectedRating === opt.value
                    ? opt.value === 'lekker'
                      ? 'bg-green-100 dark:bg-green-900 ring-2 ring-green-500 text-green-800 dark:text-green-200'
                      : opt.value === 'ok'
                        ? 'bg-amber-100 dark:bg-amber-900 ring-2 ring-amber-500 text-amber-800 dark:text-amber-200'
                        : 'bg-red-100 dark:bg-red-900 ring-2 ring-red-500 text-red-800 dark:text-red-200'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <div className="text-2xl mb-1">{opt.emoji}</div>
                <div className="text-xs font-medium">{opt.label}</div>
              </button>
            ))}
          </div>

          <textarea
            value={feedbackNotes}
            onChange={(e) => setFeedbackNotes(e.target.value)}
            placeholder="Opmerkingen (optioneel)..."
            className="w-full p-2 border rounded-lg text-sm bg-cream-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 mb-3 resize-none"
            rows={2}
            maxLength={500}
          />

          <button
            onClick={handleSaveFeedback}
            disabled={!selectedRating || savingFeedback}
            className="w-full py-2 bg-forest-500 text-white rounded-lg font-medium hover:bg-forest-600 transition-colors disabled:opacity-50"
          >
            {savingFeedback ? 'Opslaan...' : feedback ? 'Feedback bijwerken' : 'Feedback opslaan'}
          </button>

          {feedback && !savingFeedback && (
            <p className="mt-2 text-center text-xs text-green-600 dark:text-green-400">
              Feedback opgeslagen
            </p>
          )}
        </div>
      )}
    </div>
  );
}
