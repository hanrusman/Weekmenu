import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api, MenuDay, formatShortDay } from '../lib/api';
import Button from './Button';

interface ReorderDaysProps {
  /** The week's uneaten dinners, by date. */
  days: MenuDay[];
  /** After saving, with the week's days as they are now. */
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Moving the week's dinners to other days. The days stay put; the dinners
 * move over them with the arrows, and are saved together.
 */
export default function ReorderDays({ days, onSaved, onCancel }: ReorderDaysProps) {
  const [order, setOrder] = useState(days);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = order.some((d, i) => d.id !== days[i].id);

  function move(from: number, to: number) {
    setOrder((o) => {
      const next = [...o];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.reorderDays(days[0].menu_id, order.map((d) => d.id));
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const arrow = 'flex items-center justify-center w-11 h-11 rounded-full text-muted hover:text-ink hover:bg-raised transition-colors disabled:opacity-25 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

  return (
    <section aria-label="Volgorde wijzigen">
      <p className="text-sm text-muted mb-3">Schuif een gerecht naar een andere dag. De dagen blijven staan, de gerechten wisselen.</p>
      <ol className="space-y-2">
        {order.map((day, i) => (
          <li key={day.id} className="flex items-center gap-3 p-2 pl-4 rounded-3xl bg-surface shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
            <div className="flex-1 min-w-0">
              {/* The day belongs to the place in the list, not to the dinner */}
              <span className="block text-[11px] font-bold tracking-wider uppercase text-accent">
                {formatShortDay(days[i])}
              </span>
              <span className="block font-bold leading-snug line-clamp-2">{day.recipe_name}</span>
            </div>
            <button className={arrow} disabled={busy || i === 0} onClick={() => move(i, i - 1)}
              aria-label={`${day.recipe_name} een dag eerder`}>
              <ArrowUp size={18} />
            </button>
            <button className={arrow} disabled={busy || i === order.length - 1} onClick={() => move(i, i + 1)}
              aria-label={`${day.recipe_name} een dag later`}>
              <ArrowDown size={18} />
            </button>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex gap-3">
        <Button onClick={save} disabled={busy || !changed}>{busy ? 'Opslaan…' : 'Opslaan'}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Annuleren</Button>
      </div>
    </section>
  );
}
