import { Router, Request, Response } from 'express';
import { getDb } from '../db.js';
import { verifyPassword, createSession, deleteSession, checkRateLimit, resetRateLimit } from '../services/auth.js';
import { requireAuth, SESSION_COOKIE_NAME, AuthedRequest } from '../middleware/auth.js';

const router = Router();

function cookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

router.post('/login', (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    res.status(400).json({ error: 'E-mail en wachtwoord vereist' });
    return;
  }

  const rateKey = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(rateKey)) {
    res.status(429).json({ error: 'Te veel pogingen, probeer over 15 minuten opnieuw' });
    return;
  }

  const user = getDb().prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .get(email.toLowerCase().trim()) as { id: number; email: string; password_hash: string } | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Ongeldige inloggegevens' });
    return;
  }

  resetRateLimit(rateKey);
  const { token, expiresAt } = createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(expiresAt));
  res.json({ user: { id: user.id, email: user.email } });
});

router.post('/logout', (req: Request, res: Response) => {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  if (token) deleteSession(token);
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions());
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
  res.json({ user: req.user });
});

export default router;
