import type { Request, Response, NextFunction } from 'express';

export function adminAuth(req: Request, res: Response, next: NextFunction) {
  const pin = req.headers['x-admin-pin'];
  const adminPin = process.env.ADMIN_PIN;
  if (adminPin && pin !== adminPin) {
    res.status(401).json({ error: 'Admin PIN vereist' });
    return;
  }
  next();
}
