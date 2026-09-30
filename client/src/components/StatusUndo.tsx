import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Archive, RotateCcw } from 'lucide-react';
import { api, RecipeStatus } from '../lib/api';

/** A status change just made, passed along in the router state of the next page. */
export interface StatusChange {
  id: number;
  name: string;
  from: RecipeStatus;
  to: RecipeStatus;
}

export interface ReviewState {
  change?: StatusChange;
}

const DONE: Record<RecipeStatus, { text: string; icon: typeof Check }> = {
  goedgekeurd: { text: 'goedgekeurd', icon: Check },
  archief: { text: 'gearchiveerd', icon: Archive },
  concept: { text: 'terug naar concept', icon: RotateCcw },
};

/** "✓ Linzensoep goedgekeurd · Ongedaan maken", shown on the page after a status change. */
export default function StatusUndo({ change }: { change: StatusChange }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { text, icon: Icon } = DONE[change.to];

  async function undo() {
    setBusy(true);
    try {
      await api.setRecipeStatus(change.id, change.from);
      navigate(`/recepten/${change.id}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div role="status" className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 mb-4 text-sm shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
      <Icon size={16} className={change.to === 'goedgekeurd' ? 'text-green-600 shrink-0' : 'text-muted shrink-0'} />
      <span className="flex-1 min-w-0">
        <span className="font-medium">{change.name}</span> {text}
        {error && <span className="block text-red-500 text-xs">{error}</span>}
      </span>
      <button onClick={undo} disabled={busy} className="font-bold text-warmth-500 hover:text-warmth-600 disabled:opacity-50 shrink-0">
        Ongedaan maken
      </button>
    </div>
  );
}
