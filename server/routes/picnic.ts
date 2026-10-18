import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  PicnicAuthError,
  PicnicStateError,
  PicnicUncertainError,
  abandonAttempt,
  addToCart,
  disconnect,
  finishAttempt,
  picnicStatus,
  resendCode,
  searchForItem,
  searchProducts,
  startLogin,
  suggestForMenu,
  unfinishedFor,
  verifyCode,
} from '../services/picnic.js';

const router = Router();

/** Picnic's own message for what went wrong, without anything the person typed. */
function fail(res: Response, err: unknown) {
  if (err instanceof PicnicAuthError) {
    res.status(409).json({ error: err.message, reconnect: true });
    return;
  }
  if (err instanceof PicnicStateError) {
    res.status(409).json({ error: err.message, ...(err instanceof PicnicUncertainError ? { uncertain: true } : {}) });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('Picnic:', message);
  res.status(502).json({ error: `Picnic: ${message}` });
}

function menuIdOf(req: Request, res: Response): number | null {
  const menuId = Number(req.params.id);
  if (!Number.isInteger(menuId) || menuId <= 0) {
    res.status(400).json({ error: 'Ongeldig menu ID' });
    return null;
  }
  return menuId;
}

router.get('/status', (_req, res) => {
  res.json(picnicStatus());
});

router.post('/login', async (req, res) => {
  const parsed = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) })
    .safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Vul je Picnic-e-mailadres en wachtwoord in' });
    return;
  }
  try {
    res.json(await startLogin(parsed.data.email, parsed.data.password));
  } catch (err) {
    fail(res, err);
  }
});

router.post('/verify', async (req, res) => {
  const parsed = z.object({ code: z.string().trim().regex(/^\d{4,8}$/) }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Vul de code uit de sms in' });
    return;
  }
  try {
    await verifyCode(parsed.data.code);
    res.json(picnicStatus());
  } catch (err) {
    fail(res, err);
  }
});

router.post('/resend', async (_req, res) => {
  try {
    await resendCode();
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/logout', (_req, res) => {
  disconnect();
  res.json(picnicStatus());
});

// With ?item=<shopping item id> each hit carries the packs it takes for that item
router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length > 100) {
    res.status(400).json({ error: 'Zoekterm ontbreekt' });
    return;
  }
  const item = req.query.item === undefined ? null : Number(req.query.item);
  if (item !== null && (!Number.isInteger(item) || item <= 0)) {
    res.status(400).json({ error: 'Ongeldige boodschap' });
    return;
  }
  try {
    res.json(item === null ? await searchProducts(q) : await searchForItem(item, q));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/menus/:id/suggestions', async (req, res) => {
  const menuId = menuIdOf(req, res);
  if (menuId === null) return;
  try {
    // Attempts that never settled come first: their items stay held until they do
    const unfinished = unfinishedFor(menuId);
    res.json({ items: unfinished.length ? [] : await suggestForMenu(menuId), unfinished });
  } catch (err) {
    fail(res, err);
  }
});

// Attempts that did not settle; the page has them settled before anything new goes out
router.get('/menus/:id/unfinished', (req, res) => {
  const menuId = menuIdOf(req, res);
  if (menuId === null) return;
  res.json(unfinishedFor(menuId));
});

const requestIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);

const productSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(300),
  unit_quantity: z.string().max(100).nullable(),
  price: z.number().int().nullable(),
});

router.post('/menus/:id/cart', async (req, res) => {
  const menuId = menuIdOf(req, res);
  if (menuId === null) return;
  const parsed = z.object({
    // The same id for a retry of the same attempt, so it cannot add twice
    request_id: requestIdSchema,
    lines: z.array(z.object({
      item_id: z.number().int().positive(),
      product: productSchema,
      count: z.number().int().min(1).max(50),
      picked: z.boolean().optional(),
    })).min(1).max(200),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Kies minstens één product' });
    return;
  }
  try {
    res.json(await addToCart(menuId, parsed.data.request_id, parsed.data.lines));
  } catch (err) {
    fail(res, err);
  }
});

// Carry on with an attempt that did not settle: looks in the basket, sends only what is missing
router.post('/menus/:id/cart/:requestId/finish', async (req, res) => {
  const menuId = menuIdOf(req, res);
  if (menuId === null) return;
  const requestId = requestIdSchema.safeParse(req.params.requestId);
  if (!requestId.success) {
    res.status(400).json({ error: 'Ongeldig verzoek' });
    return;
  }
  try {
    res.json(await finishAttempt(menuId, requestId.data));
  } catch (err) {
    fail(res, err);
  }
});

// Give it up: ticks off what the basket shows went in, lets the rest go
router.post('/menus/:id/cart/:requestId/abandon', async (req, res) => {
  const menuId = menuIdOf(req, res);
  if (menuId === null) return;
  const requestId = requestIdSchema.safeParse(req.params.requestId);
  if (!requestId.success) {
    res.status(400).json({ error: 'Ongeldig verzoek' });
    return;
  }
  try {
    res.json(await abandonAttempt(menuId, requestId.data));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
