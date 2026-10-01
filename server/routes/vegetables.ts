import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { isParserConfigured } from '../services/recipe-parser.js';
import { recipesToBoost, startVegetableJob, vegetableJob } from '../services/vegetable-job.js';
import { assessRecipes } from '../services/recipes.js';
import { VEGETABLE_MINIMUM, VEGETABLE_TARGET } from '../services/vegetables.js';

const router = Router();

// GET /api/vegetables - where the library stands, the run, and what each recipe came to
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const assessments = assessRecipes(db);
  const recipes = db.prepare(`
    SELECT r.id, r.name, r.status, r.course, r.veg_exception, r.veg_outcome, r.veg_note, r.veg_checked_at,
           v.veg_before, v.veg_after
    FROM recipes r
    LEFT JOIN recipe_revisions v ON v.id = (
      SELECT id FROM recipe_revisions WHERE recipe_id = r.id AND reason = 'groente' ORDER BY id DESC LIMIT 1)
    WHERE r.status != 'archief'
  `).all() as Array<{
    id: number; name: string; status: string; course: string | null; veg_exception: number;
    veg_outcome: string | null; veg_note: string | null; veg_checked_at: string | null;
    veg_before: number | null; veg_after: number | null;
  }>;
  const dinners = recipes.filter((r) => r.course === 'hoofdgerecht');
  const below = dinners.filter((r) => (assessments.get(r.id)?.veg.per_serving ?? 0) < (r.veg_exception ? VEGETABLE_MINIMUM : VEGETABLE_TARGET));
  const incomplete = dinners.filter((r) => (assessments.get(r.id)?.meal.missing.length ?? 2) > 0);
  const unknown = recipes.filter((r) => r.course === null);
  res.json({
    configured: isParserConfigured(),
    target: VEGETABLE_TARGET,
    minimum: VEGETABLE_MINIMUM,
    counts: {
      dinners: dinners.length,
      below: below.length,
      incomplete: incomplete.length,
      unknown: unknown.length,
      to_do: recipesToBoost(db).length,
      not_main: recipes.length - dinners.length - unknown.length,
    },
    job: vegetableJob(),
    results: recipes
      .filter((r) => r.veg_outcome && r.veg_outcome !== 'enough')
      .sort((a, b) => (b.veg_checked_at ?? '').localeCompare(a.veg_checked_at ?? ''))
      .map((r) => ({
        id: r.id, name: r.name, outcome: r.veg_outcome, note: r.veg_note,
        before: r.veg_before, after: r.veg_after, now: assessments.get(r.id)?.veg.per_serving ?? 0,
      })),
  });
});

// POST /api/vegetables/run - { ids? } top up what is left (or these recipes) in the background
router.post('/run', (req: Request, res: Response) => {
  const parsed = z.object({ ids: z.array(z.number().int().positive()).max(500).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Ongeldige lijst met recepten' });
    return;
  }
  if (!isParserConfigured()) {
    res.status(503).json({ error: 'Taalmodel niet geconfigureerd (LITELLM_URL / LITELLM_API_KEY)' });
    return;
  }
  const run = startVegetableJob(getDb(), parsed.data.ids);
  if (!run) {
    res.status(409).json({ error: 'Er loopt al een ronde' });
    return;
  }
  run.catch((err) => console.error('Groente-ronde mislukt:', err));
  res.status(202).json({ job: vegetableJob() });
});

export default router;
