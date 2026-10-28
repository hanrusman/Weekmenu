import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { getTargetWeek } from '../services/menu-generator.js';
import { parseProposalRequest, plannerState, proposalJob, startProposal } from '../services/menu-planner.js';
import { chatAboutDay, parseChatRequest } from '../services/menu-chat.js';
import { isModelConfigured } from '../services/llm.js';
import { RecipeError } from '../services/recipes.js';

const router = Router();

// GET /api/planner?week=45&year=2026 - the library, the week's days and what is there, for the picker
router.get('/', (req: Request, res: Response) => {
  const target = getTargetWeek(new Date());
  const week = req.query.week === undefined ? target.weekNumber : Number(req.query.week);
  const year = req.query.year === undefined ? target.year : Number(req.query.year);
  if (!Number.isInteger(week) || week < 1 || week > 53 || !Number.isInteger(year) || year < 2020 || year > 2100) {
    res.status(400).json({ error: 'Ongeldige week' });
    return;
  }
  res.json(plannerState(getDb(), week, year));
});

// POST /api/planner/propose - { week_number, year, days, breakfasts, snacks, wishes } a model fills the open days, in the background
router.post('/propose', (req: Request, res: Response) => {
  let request;
  try {
    request = parseProposalRequest(req.body);
  } catch (err) {
    res.status(err instanceof RecipeError ? err.status : 400).json({ error: (err as Error).message });
    return;
  }
  if (!isModelConfigured()) {
    res.status(503).json({ error: 'Taalmodel niet geconfigureerd (LITELLM_URL / LITELLM_API_KEY)' });
    return;
  }
  const run = startProposal(getDb(), request);
  if (!run) {
    res.status(409).json({ error: 'Er wordt al een menu voorgesteld' });
    return;
  }
  res.status(202).json({ job: proposalJob() });
});

// POST /api/planner/chat - { week_number, year, day_name, days, messages } the assistant's dinners for a wish
router.post('/chat', async (req: Request, res: Response) => {
  let request;
  try {
    request = parseChatRequest(req.body);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }
  if (!isModelConfigured()) {
    res.status(503).json({ error: 'Taalmodel niet geconfigureerd (LITELLM_URL / LITELLM_API_KEY)' });
    return;
  }
  try {
    res.json(await chatAboutDay(getDb(), request));
  } catch (err) {
    if (err instanceof RecipeError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('Menu-assistent mislukt:', err);
    res.status(500).json({ error: 'De assistent is even niet bereikbaar' });
  }
});

// GET /api/planner/proposal - the proposal running now, or the last one
router.get('/proposal', (_req: Request, res: Response) => {
  res.json({ job: proposalJob() });
});

export default router;
