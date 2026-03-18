import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { adminAuth } from '../server/middleware/auth';
import type { Request, Response, NextFunction } from 'express';

function createMockReqRes(headers: Record<string, string> = {}) {
  const req = { headers, query: {} } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('adminAuth middleware', () => {
  const originalEnv = process.env.ADMIN_PIN;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ADMIN_PIN = originalEnv;
    } else {
      delete process.env.ADMIN_PIN;
    }
  });

  it('should call next() when no ADMIN_PIN is set', () => {
    delete process.env.ADMIN_PIN;
    const { req, res, next } = createMockReqRes();
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should call next() when correct PIN is provided in header', () => {
    process.env.ADMIN_PIN = '1234';
    const { req, res, next } = createMockReqRes({ 'x-admin-pin': '1234' });
    adminAuth(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 401 when wrong PIN is provided', () => {
    process.env.ADMIN_PIN = '1234';
    const { req, res, next } = createMockReqRes({ 'x-admin-pin': 'wrong' });
    adminAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin PIN vereist' });
  });

  it('should return 401 when no PIN is provided but ADMIN_PIN is set', () => {
    process.env.ADMIN_PIN = '1234';
    const { req, res, next } = createMockReqRes();
    adminAuth(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should not accept PIN from query params (security)', () => {
    process.env.ADMIN_PIN = '1234';
    const { req, res, next } = createMockReqRes();
    (req.query as Record<string, string>).pin = '1234';
    adminAuth(req, res, next);
    // PIN in query param should NOT be accepted (removed for security)
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
