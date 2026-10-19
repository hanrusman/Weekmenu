import { Router, type Response } from 'express';
import { z } from 'zod';
import { AhApiError, AhAuthError, AhStateError, ahStatus } from '../services/ah-client.js';
import { addToAhCart, connectAhAccount, disconnectAhAccount, searchForAhItem, settleAhAttempt, suggestForAhMenu, unfinishedAh } from '../services/albert-heijn.js';

const router = Router();
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const positiveId = z.coerce.number().int().positive();
const requestId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const product = z.object({
  id: z.string().regex(/^[1-9]\d{0,9}$/), name: z.string().min(1).max(300),
  unit_quantity: z.string().max(100).nullable(), price: z.number().int().nonnegative().nullable(),
  frozen: z.boolean().nullable(), organic: z.boolean(), house_brand: z.boolean(),
});
const cart = z.object({
  request_id: requestId,
  lines: z.array(z.object({ item_id: z.number().int().positive(), product, count: z.number().int().min(1).max(50), picked: z.boolean() })).min(1).max(200),
});

function fail(res: Response, err: unknown) {
  if (err instanceof AhStateError) res.status(409).json({ error: err.message, ...(err instanceof AhAuthError ? { reconnect: true } : {}) });
  else if (err instanceof AhApiError) res.status(502).json({ error: err.message });
  else res.status(502).json({ error: 'Albert Heijn kon de aanvraag niet afronden. Probeer opnieuw; een eerdere toevoegpoging wordt eerst gecontroleerd.' });
}
router.get('/status', (_req, res) => res.json(ahStatus()));
router.post('/connect', async (req, res) => {
  const parsed = z.object({ code: z.string().trim().min(4).max(4096) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Plak de AH-inlogcode of inloglink.' }); return; }
  try { await connectAhAccount(parsed.data.code); res.json(ahStatus()); } catch (err) { fail(res, err); }
});
router.post('/logout', async (_req, res) => {
  try { await disconnectAhAccount(); res.json(ahStatus()); } catch (err) { fail(res, err); }
});
router.get('/search', async (req, res) => {
  const parsed = z.object({ item: positiveId, q: z.string().trim().min(1).max(100) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Kies een boodschap en vul een zoekterm in.' }); return; }
  try { res.json(await searchForAhItem(parsed.data.item, parsed.data.q)); } catch (err) { fail(res, err); }
});
router.get('/unfinished', (_req, res) => res.json(unfinishedAh()));
router.get('/menus/:id/suggestions', async (req, res) => {
  const parsed = positiveId.safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: 'Ongeldig menu.' }); return; }
  try {
    const unfinished = unfinishedAh();
    res.json({ items: unfinished.length ? [] : await suggestForAhMenu(parsed.data), unfinished });
  } catch (err) { fail(res, err); }
});
router.post('/menus/:id/cart', async (req, res) => {
  const menuId = positiveId.safeParse(req.params.id);
  const parsed = cart.safeParse(req.body);
  if (!menuId.success || !parsed.success) { res.status(400).json({ error: 'Kies geldige producten en aantallen.' }); return; }
  try { res.json(await addToAhCart(menuId.data, parsed.data.request_id, parsed.data.lines)); } catch (err) { fail(res, err); }
});
for (const action of ['finish', 'abandon'] as const) {
  router.post(`/menus/:id/cart/:requestId/${action}`, async (req, res) => {
    const parsed = z.object({ id: positiveId, requestId }).safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: 'Ongeldige poging.' }); return; }
    try { res.json(await settleAhAttempt(parsed.data.id, parsed.data.requestId, action === 'abandon')); } catch (err) { fail(res, err); }
  });
}
export default router;
