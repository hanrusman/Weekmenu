import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatShortRange } from '../lib/api';

interface WeekSwitcherProps {
  weekNumber: number | undefined;
  firstDate: string | null | undefined;
  lastDate: string | null | undefined;
  /** Where this week lies from today. */
  when: 'past' | 'current' | 'future';
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Back to the running week; shown when another week is open. */
  onToday?: () => void;
}

const WHEN_LABEL = { past: 'Vorige week', current: 'Deze week', future: 'Volgende week' };

/** Week number and dates between two arrows, so it is always clear which week this is. */
export default function WeekSwitcher({
  weekNumber, firstDate, lastDate, when, canPrev, canNext, onPrev, onNext, onToday,
}: WeekSwitcherProps) {
  const arrow = 'flex items-center justify-center w-11 h-11 rounded-full text-muted hover:text-ink hover:bg-raised transition-colors disabled:opacity-25 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 flex items-center justify-between bg-surface rounded-full p-1 shadow-[0_4px_20px_rgba(0,0,0,0.04)] border border-line-soft">
        <button onClick={onPrev} disabled={!canPrev} className={arrow} aria-label="Vorige week">
          <ChevronLeft size={20} />
        </button>
        <div className="text-center leading-tight" aria-live="polite">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">{WHEN_LABEL[when]}</div>
          <div className="text-sm font-bold whitespace-nowrap">
            {weekNumber ? `Week ${weekNumber}` : ''}
            {weekNumber && firstDate ? ' · ' : ''}
            <span className="font-medium text-muted">{formatShortRange(firstDate, lastDate)}</span>
          </div>
        </div>
        <button onClick={onNext} disabled={!canNext} className={arrow} aria-label="Volgende week">
          <ChevronRight size={20} />
        </button>
      </div>
      {onToday && when !== 'current' && (
        <button onClick={onToday}
          className="shrink-0 min-h-11 px-4 rounded-full bg-surface border border-line-soft text-xs font-bold text-brand hover:bg-raised transition-colors">
          Deze week
        </button>
      )}
    </div>
  );
}
