import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getSessionUser } from '../services/auth.js';

export interface AuthedRequest extends Request {
  user?: { id: number; email: string };
}

const SESSION_COOKIE = 'weekmenu_session';

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: 'Niet ingelogd' });
    return;
  }
  req.user = user;
  next();
}

// Block state-changing requests from cross-origin sources.
// Combined with SameSite=Lax cookies this gives two layers of CSRF defense.
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  const host = req.headers.host;
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      res.status(403).json({ error: 'Ongeldige origin' });
      return;
    }
  } catch {
    res.status(403).json({ error: 'Ongeldige origin' });
    return;
  }
  next();
}

export function requireHaToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.HA_API_TOKEN;
  if (!expected) {
    res.status(503).json({ error: 'HA_API_TOKEN niet geconfigureerd' });
    return;
  }
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token || token.length !== expected.length || !timingEqual(token, expected)) {
    res.status(401).json({ error: 'Ongeldig HA token' });
    return;
  }
  next();
}

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
