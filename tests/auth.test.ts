import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requireAuth, requireHaToken, csrfGuard } from '../server/middleware/auth';
import { cookieOptions } from '../server/routes/auth';
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession } from '../server/services/auth';
import { getDb } from '../server/db';
import type { Request, Response, NextFunction } from 'express';

function mockRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe('password hashing', () => {
  it('verifies the correct password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces different hashes for the same password (salt)', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });
});

describe('sessions', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM sessions; DELETE FROM users;');
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)')
      .run('test@example.com', hashPassword('x'));
  });

  it('creates and retrieves a session', () => {
    const { token } = createSession(1);
    const user = getSessionUser(token);
    expect(user).toEqual({ id: 1, email: 'test@example.com' });
  });

  it('returns null for unknown token', () => {
    expect(getSessionUser('nope')).toBeNull();
  });

  it('deletes a session', () => {
    const { token } = createSession(1);
    deleteSession(token);
    expect(getSessionUser(token)).toBeNull();
  });
});

describe('requireAuth middleware', () => {
  beforeEach(() => {
    const db = getDb();
    db.exec('DELETE FROM sessions; DELETE FROM users;');
    db.prepare('INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)')
      .run('test@example.com', hashPassword('x'));
  });

  it('calls next() with a valid session cookie', () => {
    const { token } = createSession(1);
    const req = { cookies: { weekmenu_session: token } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requireAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 without a session cookie', () => {
    const req = { cookies: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requireAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireHaToken middleware', () => {
  it('returns 503 when HA_API_TOKEN not configured', () => {
    delete process.env.HA_API_TOKEN;
    const req = { headers: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requireHaToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 with wrong token', () => {
    process.env.HA_API_TOKEN = 'secrettoken1234567890';
    const req = { headers: { authorization: 'Bearer wrong-token-padding-xxx' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requireHaToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() with correct bearer token', () => {
    process.env.HA_API_TOKEN = 'secrettoken1234567890';
    const req = { headers: { authorization: 'Bearer secrettoken1234567890' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    requireHaToken(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('cookieOptions', () => {
  const ENV_KEYS = ['COOKIE_SAMESITE', 'COOKIE_SECURE', 'NODE_ENV'] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults to SameSite=Lax, httpOnly, not secure outside production', () => {
    delete process.env.COOKIE_SAMESITE;
    process.env.NODE_ENV = 'test';
    const opts = cookieOptions();
    expect(opts.sameSite).toBe('lax');
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(false);
  });

  it('is secure in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.COOKIE_SECURE;
    expect(cookieOptions().secure).toBe(true);
  });

  it('allows COOKIE_SECURE=false to disable secure in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.COOKIE_SECURE = 'false';
    expect(cookieOptions().secure).toBe(false);
  });

  it('COOKIE_SAMESITE=none forces secure on, even with COOKIE_SECURE=false', () => {
    process.env.NODE_ENV = 'test';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_SAMESITE = 'none';
    const opts = cookieOptions();
    expect(opts.sameSite).toBe('none');
    expect(opts.secure).toBe(true);
    expect(opts.httpOnly).toBe(true);
  });

  it('accepts COOKIE_SAMESITE=strict', () => {
    process.env.COOKIE_SAMESITE = 'Strict';
    expect(cookieOptions().sameSite).toBe('strict');
  });

  it('falls back to lax on an invalid COOKIE_SAMESITE value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.COOKIE_SAMESITE = 'banana';
    expect(cookieOptions().sameSite).toBe('lax');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('passes the expiry date through', () => {
    const expires = new Date('2030-01-01T00:00:00Z');
    expect(cookieOptions(expires).expires).toBe(expires);
  });
});

describe('csrfGuard middleware', () => {
  it('allows GET requests', () => {
    const req = { method: 'GET', headers: {} } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    csrfGuard(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows POST with matching origin', () => {
    const req = { method: 'POST', headers: { origin: 'https://weekmenu.c4w.nl', host: 'weekmenu.c4w.nl' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    csrfGuard(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects POST with mismatched origin', () => {
    const req = { method: 'POST', headers: { origin: 'https://evil.example.com', host: 'weekmenu.c4w.nl' } } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    csrfGuard(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
