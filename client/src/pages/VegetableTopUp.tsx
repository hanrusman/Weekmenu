import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Sprout } from 'lucide-react';
import { api, VegetableOverview } from '../lib/api';

const POLL_MS = 3000;

type Result = VegetableOverview['results'][number];

const GROUPS: Array<{ outcome: Result['outcome']; title: string }> = [
  { outcome: 'boosted', title: 'Aangevuld' },
  { outcome: 'failed', title: 'Niet gelukt' },
  { outcome: 'stale', title: 'Intussen bewerkt' },
  { outcome: 'not_main', title: 'Ander soort gerecht' },
  { outcome: 'reverted', title: 'Teruggezet' },
];

/**
 * Bring all dinners up to the vegetable aim, as whole meals, in one go: a
 * background run on the server that has a model propose more vegetables (and
 * what a meal lacks) per recipe, and tell what kind of dish the others are.
 * Every change keeps the original, to undo on the recipe itself.
 */
export default function VegetableTopUp() {
  const [overview, setOverview] = useState<VegetableOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const running = overview?.job.running ?? false;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const next = await api.getVegetables();
        if (!alive) return;
        setOverview(next);
        setError(null);
        if (next.job.running) timer = setTimeout(load, POLL_MS);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    };
    load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [running]);

  async function start(ids?: number[]) {
    setStarting(true);
    setError(null);
    try {
      const { job } = await api.runVegetables(ids);
      setOverview((o) => (o ? { ...o, job } : o));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStarting(false);
    }
  }

  if (!overview) {
    return <div className="p-6 pt-16 text-center text-muted">{error || 'Laden...'}</div>;
  }

  const { counts, job, results, target, minimum } = overview;
  const failedIds = results.filter((r) => r.outcome === 'failed').map((r) => r.id);

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto pt-8 md:pt-12 pb-32">
      <Link to="/recepten" className="flex items-center gap-2 text-muted text-sm mb-6 hover:text-ink transition-colors">
        <ArrowLeft size={16} /> recepten
      </Link>

      <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Groente aanvullen</h1>
      <p className="text-sm text-muted mb-6">
        Het doel is {target} g groente per volwassene per avond. Een uitzondering zoals pizza moet minstens {minimum} g halen,
        met een bijgerecht. Een taalmodel vult elk hoofdgerecht onder de norm aan: eerst met meer van de groente die erin zit,
        anders met iets ernaast. Mist een hoofdgerecht koolhydraten of eiwit, dan komt dat er ook bij (brood bij soep,
        aardappelen bij een stoofpot), of het wordt een bijgerecht. Van recepten waarvan de soort nog onbekend is, bepaalt het
        model die. De app telt alles daarna zelf na. Het origineel blijft bewaard; op het recept kun je het terugzetten.
      </p>

      <div className="bg-white rounded-3xl p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] mb-4 text-sm space-y-1">
        <p><strong>{counts.below}</strong> van de {counts.dinners} hoofdgerechten halen hun norm niet.</p>
        {counts.incomplete > 0 && (
          <p><strong>{counts.incomplete}</strong> {counts.incomplete === 1 ? 'is' : 'zijn'} geen hele maaltijd (te weinig koolhydraten of eiwit).</p>
        )}
        <p className="text-muted">
          {counts.to_do} nog niet geprobeerd
          {counts.unknown > 0 && <> · {counts.unknown} soort nog onbekend</>}
          {' · '}{counts.not_main} ander soort gerecht (bijgerecht, lunch, ontbijt, snack, toetje)
        </p>
      </div>

      {!overview.configured && (
        <div className="bg-warmth-400/20 p-3 rounded-2xl mb-4 text-sm">Het taalmodel is op deze server niet ingesteld.</div>
      )}
      {(error || job.error) && (
        <div role="alert" className="bg-red-50 text-red-600 p-3 rounded-2xl mb-4 text-sm">{error || job.error}</div>
      )}

      {running ? (
        <div className="bg-white rounded-2xl p-4 mb-6 shadow-[0_10px_30px_rgba(0,0,0,0.1)]">
          <div className="flex items-center gap-2 text-sm font-bold mb-1.5">
            <Loader2 size={16} className="animate-spin" /> {job.done} van {job.total} verwerkt
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-warmth-500 transition-all" style={{ width: `${(job.done / Math.max(1, job.total)) * 100}%` }} />
          </div>
          <p className="text-xs text-muted">
            {job.counts.boosted} aangevuld · {job.counts.not_main} ander soort gerecht · {job.counts.failed} niet gelukt
            {job.counts.stale > 0 && <> · {job.counts.stale} intussen bewerkt</>}
            {job.current.length > 0 && <> · nu: {job.current.join(', ')}</>}
          </p>
        </div>
      ) : (
        <button onClick={() => start()} disabled={starting || counts.to_do === 0 || !overview.configured}
          className="w-full flex items-center justify-center gap-2 py-4 mb-6 bg-warmth-500 text-white rounded-2xl font-bold shadow-[0_10px_30px_rgba(242,153,74,0.3)] hover:bg-warmth-600 transition-colors disabled:opacity-50">
          <Sprout size={18} />
          {counts.to_do === 0 ? 'Niets meer aan te vullen' : `Vul ${counts.to_do} ${counts.to_do === 1 ? 'recept' : 'recepten'} aan`}
        </button>
      )}

      {GROUPS.map(({ outcome, title }) => {
        const group = results.filter((r) => r.outcome === outcome);
        if (group.length === 0) return null;
        return (
          <section key={outcome} className="mb-6">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-bold text-sm tracking-wide text-accent uppercase">{title} ({group.length})</h2>
              {outcome === 'failed' && !running && (
                <button onClick={() => start(failedIds)} disabled={starting || !overview.configured}
                  className="text-sm font-bold text-warmth-500 hover:text-warmth-600 disabled:opacity-50">
                  Opnieuw proberen
                </button>
              )}
            </div>
            <ul className="bg-white rounded-3xl divide-y divide-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.03)] text-sm">
              {group.map((r) => (
                <li key={r.id} className="px-5 py-3">
                  <Link to={`/recepten/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                  {outcome === 'boosted' && r.before !== null && r.before !== r.after && (
                    <span className="text-green-700 font-bold"> {r.before} → {r.after} g</span>
                  )}
                  {r.note && <span className="block text-xs text-muted">{r.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
