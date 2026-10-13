import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock } from 'lucide-react';
import { api, MenuDay, formatShortDay } from '../lib/api';
import { MEAL_TYPE_EMOJI, recipeImageUrl } from '../lib/mealImages';
import MealImage from './MealImage';
import Button from './Button';
import { StarInput } from './Stars';

interface TodayCardProps {
  day: MenuDay;
  /** The day as it is after ticking off or rating, so the week view can follow. */
  onChange: (day: MenuDay) => void;
}

/**
 * Tonight's dinner, big: open the recipe, tick it off when eaten, and rate it
 * right here. A note goes on the recipe page.
 */
export default function TodayCard({ day, onChange }: TodayCardProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ratings are saved one at a time, in order, so a quick second tap cannot be
  // overtaken by the first; a tap superseded before its turn is not sent at all
  const saving = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<number | null>(null);
  const done = day.status === 'completed';

  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await api.completeDay(day.menu_id, day.id);
      onChange({ ...day, status: 'completed', completed_at: new Date().toISOString() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function rate(stars: number) {
    const before = day.stars ?? null;
    latest.current = stars;
    onChange({ ...day, stars });
    setError(null);
    saving.current = saving.current.then(async () => {
      if (latest.current !== stars) return;
      try {
        // Keep a note given on the recipe page
        const existing = await api.getDayFeedback(day.menu_id, day.id);
        if (latest.current !== stars) return;
        await api.saveFeedback(day.menu_id, day.id, stars, existing?.notes ?? undefined);
      } catch (err) {
        if (latest.current !== stars) return;
        onChange({ ...day, stars: before });
        setError((err as Error).message);
      }
    });
  }

  return (
    <section aria-label="Vandaag"
      className="relative bg-surface rounded-[2rem] p-5 border-2 border-warmth-400 shadow-[0_15px_35px_rgba(245,217,193,0.35)]">
      <span className="absolute -top-3 left-5 bg-brand text-on-brand text-[10px] font-bold px-3 py-1 rounded-full tracking-wider uppercase">
        Vandaag · {formatShortDay(day)}
      </span>

      <Link to={`/dag/${day.id}`} className="flex items-center gap-4 mt-1 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <div className="w-24 h-24 shrink-0 flex items-center justify-center">
          <MealImage
            ownSrc={recipeImageUrl(day.recipe_id, day.recipe_image_version)}
            recipeName={day.recipe_name}
            mealType={day.meal_type}
            size={96}
            className="w-24 h-24"
            fallback={<span className="text-5xl">{MEAL_TYPE_EMOJI[day.meal_type] || '🍽️'}</span>}
          />
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-bold leading-tight">{day.recipe_name}</h2>
          {day.prep_time_minutes ? (
            <span className="inline-flex items-center gap-1 mt-1.5 text-sm font-medium text-muted">
              <Clock size={14} /> {day.prep_time_minutes} min
            </span>
          ) : null}
        </div>
      </Link>

      {!done ? (
        <div className="grid grid-cols-2 gap-3 mt-5">
          <Link to={`/dag/${day.id}`}
            className="inline-flex items-center justify-center min-h-11 px-4 rounded-2xl text-sm font-bold bg-surface text-ink border border-line hover:bg-raised transition-all">
            Recept
          </Link>
          <Button onClick={complete} disabled={busy}>
            <Check size={16} />
            {busy ? 'Bezig…' : 'Gegeten'}
          </Button>
        </div>
      ) : (
        <div className="mt-5 pt-4 border-t border-line-soft text-center">
          <p className="text-sm font-bold mb-1">{day.stars ? 'Bedankt!' : 'Hoe was het?'}</p>
          <StarInput value={day.stars ?? null} onChange={rate} size={30} />
          {day.stars ? (
            <Link to={`/dag/${day.id}`} className="inline-block mt-2 text-xs font-bold text-brand hover:text-brand-hover">
              Opmerking toevoegen
            </Link>
          ) : null}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-danger text-center">{error}</p>}
    </section>
  );
}
