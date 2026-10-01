import type Database from 'better-sqlite3';
import { boostRecipe, BoostOutcome, BoostReport } from './vegetable-boost.js';
import { assessRecipes } from './recipes.js';
import { VEGETABLE_MINIMUM, VEGETABLE_TARGET } from './vegetables.js';

/**
 * The bulk vegetable top-up as a job in the server process: a model call can
 * take over a minute, longer than the reverse proxy waits, and a whole run
 * half an hour. The page starts it and polls its progress. What each recipe
 * came to is stored on the recipe, so a restart only loses the in-memory
 * progress; starting again continues with what is left.
 */

export interface VegetableJob {
  running: boolean;
  started_at: string | null;
  finished_at: string | null;
  total: number;
  done: number;
  counts: Record<BoostOutcome, number>;
  /** Names being worked on right now. */
  current: string[];
  /** Set when the job stopped on something that concerns every recipe (model not configured). */
  error: string | null;
}

const CONCURRENCY = 2;

let job: VegetableJob = idle();

function idle(): VegetableJob {
  return {
    running: false, started_at: null, finished_at: null, total: 0, done: 0,
    counts: { boosted: 0, not_main: 0, enough: 0, failed: 0, stale: 0 }, current: [], error: null,
  };
}

export function vegetableJob(): VegetableJob {
  return { ...job, counts: { ...job.counts }, current: [...job.current] };
}

/**
 * What no run has handled yet, in library order: dinners below their
 * vegetable norm or that are no whole meal, and recipes whose kind is not
 * known yet.
 */
export function recipesToBoost(db: Database.Database): number[] {
  const assessments = assessRecipes(db);
  const rows = db.prepare(`
    SELECT id, course, veg_exception FROM recipes
    WHERE (course IS NULL OR course = 'hoofdgerecht') AND status != 'archief' AND veg_checked_at IS NULL
    ORDER BY CASE status WHEN 'goedgekeurd' THEN 0 ELSE 1 END, id
  `).all() as Array<{ id: number; course: string | null; veg_exception: number }>;
  return rows
    .filter((r) => {
      if (r.course === null) return true;
      const a = assessments.get(r.id);
      return (a?.veg.per_serving ?? 0) < (r.veg_exception ? VEGETABLE_MINIMUM : VEGETABLE_TARGET) || (a?.meal.missing.length ?? 2) > 0;
    })
    .map((r) => r.id);
}

/**
 * Start a run over `ids` (or everything still to do). Returns false when one
 * is already running; otherwise the run's promise, which the route does not
 * wait for.
 */
export function startVegetableJob(
  db: Database.Database,
  ids?: number[],
  boost: (db: Database.Database, id: number) => Promise<BoostReport> = boostRecipe,
): false | Promise<void> {
  if (job.running) return false;
  const queue = [...(ids ?? recipesToBoost(db))];
  const nameOf = db.prepare('SELECT name FROM recipes WHERE id = ?');
  job = { ...idle(), running: true, started_at: new Date().toISOString(), total: queue.length };

  const worker = async () => {
    while (queue.length && !job.error) {
      const id = queue.shift()!;
      const name = (nameOf.get(id) as { name: string } | undefined)?.name ?? `#${id}`;
      job.current.push(name);
      try {
        job.counts[(await boost(db, id)).outcome]++;
      } catch (err) {
        const status = (err as { status?: number }).status;
        if (status === 503) job.error = (err as Error).message; // stops the run
        else job.counts.failed++;
        if (status !== 503) console.error(`Groente aanvullen #${id} mislukt:`, err);
      } finally {
        job.current = job.current.filter((n) => n !== name);
        job.done++;
      }
    }
  };
  return Promise.all(Array.from({ length: CONCURRENCY }, worker)).then(() => {
    job.running = false;
    job.finished_at = new Date().toISOString();
  });
}
