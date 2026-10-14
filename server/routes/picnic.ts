import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  PicnicAuthError,
  PicnicStateError,
  addToCart,
  disconnect,
  picnicStatus,
  resendCode,
  searchProducts,
  startLogin,
  suggestForMenu,
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
    res.status(409).json({ error: err.message });
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

router.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!q || q.length > 100) {
    res.status(400).json({ error: 'Zoekterm ontbreekt' });
    return;
  }
  try {
    res.json(await searchProducts(q));
  } catch (err) {
    fail(res, err);
  }
});

router.get('/menus/:id/suggestions', async (req, res) => {
  const menuId = menuIdOf(req, res);
  if (menuId === null) return;
  try {
    res.json(await suggestForMenu(menuId));
  } catch (err) {
    fail(res, err);
  }
});

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
    lines: z.array(z.object({
      item_id: z.number().int().positive(),
      product: productSchema,
      count: z.number().int().min(1).max(50),
    })).min(1).max(200),
  }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Kies minstens één product' });
    return;
  }
  try {
    res.json(await addToCart(menuId, parsed.data.lines));
  } catch (err) {
    fail(res, err);
  }
});

export default router;
