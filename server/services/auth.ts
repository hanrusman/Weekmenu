import crypto from 'crypto';
import { getDb } from '../db.js';

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384;
const SESSION_TTL_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST });
  return `scrypt$${SCRYPT_COST}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const cost = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'base64');
  const expected = Buffer.from(parts[3], 'base64');
  const actual = crypto.scryptSync(password, salt, expected.length, { N: cost });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function createSession(userId: number): { token: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  getDb().prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function getSessionUser(token: string | undefined): { id: number; email: string } | null {
  if (!token) return null;
  const row = getDb().prepare(`
    SELECT u.id, u.email, s.expires_at
    FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ?
  `).get(token) as { id: number; email: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  return { id: row.id, email: row.email };
}

export function deleteSession(token: string): void {
  getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function pruneExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// Simple in-memory rate limiter: 5 attempts per 15 min per key
const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// Cap the map so spoofed keys (e.g. forged X-Forwarded-For) can't exhaust memory
const MAX_KEYS = 10_000;

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(key, recent);
    return false;
  }
  recent.push(now);
  if (!attempts.has(key) && attempts.size >= MAX_KEYS) {
    pruneAttempts(now);
  }
  attempts.set(key, recent);
  return true;
}

function pruneAttempts(now: number): void {
  for (const [key, times] of attempts) {
    if (!times.some(t => now - t < WINDOW_MS)) attempts.delete(key);
  }
  // Still full after dropping expired entries: evict oldest (insertion order)
  while (attempts.size >= MAX_KEYS) {
    const oldest = attempts.keys().next().value;
    if (oldest === undefined) break;
    attempts.delete(oldest);
  }
}

export function resetRateLimit(key: string): void {
  attempts.delete(key);
}
