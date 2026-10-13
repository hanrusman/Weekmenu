import { useState } from 'react';
import { Star } from 'lucide-react';

export const STAR_LABELS = ['', 'Niet lekker', 'Matig', 'Prima', 'Lekker', 'Heerlijk'];

interface StarInputProps {
  value: number | null;
  onChange: (stars: number) => void;
  size?: number;
  disabled?: boolean;
  /** Show the word for the chosen (or hovered) number of stars underneath. */
  showLabel?: boolean;
}

/** One to five stars to tap; a radio group for screen readers. */
export function StarInput({ value, onChange, size = 32, disabled, showLabel = true }: StarInputProps) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;

  return (
    <div className="flex flex-col items-center">
      <div role="radiogroup" aria-label="Beoordeling" className="flex gap-1" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? 'ster' : 'sterren'}: ${STAR_LABELS[n]}`}
            disabled={disabled}
            onClick={() => onChange(n)}
            onMouseEnter={() => setHover(n)}
            className="p-1 rounded-full transition-transform active:scale-90 hover:scale-110 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warmth-400"
          >
            <Star
              size={size}
              strokeWidth={1.75}
              className={n <= shown ? 'text-brand fill-brand' : 'text-faint'}
            />
          </button>
        ))}
      </div>
      {showLabel && (
        <span className="text-xs font-medium text-muted h-4 mt-1">{shown ? STAR_LABELS[shown] : ''}</span>
      )}
    </div>
  );
}

/** A rating to read: five small stars for one score. */
export function StarScore({ stars, size = 12 }: { stars: number; size?: number }) {
  return (
    <span className="inline-flex gap-px" role="img" aria-label={`${stars} van 5 sterren`} title={STAR_LABELS[stars]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} strokeWidth={2}
          className={n <= stars ? 'text-brand fill-brand' : 'text-faint'} />
      ))}
    </span>
  );
}

/** An average over several ratings: "★ 4,3 (3×)". */
export function StarAverage({ avg, count }: { avg: number | null; count: number }) {
  if (!count || avg === null) return null;
  const text = String(Math.round(avg * 10) / 10).replace('.', ',');
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted"
      title={`Gemiddeld ${text} van 5 sterren, ${count}× beoordeeld`}>
      <Star size={12} className="text-brand fill-brand" />
      <span className="text-ink font-bold">{text}</span>
      <span>({count}×)</span>
    </span>
  );
}
