import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../client/src/lib/api';

describe('safeJsonParse', () => {
  it('should parse valid JSON', () => {
    expect(safeJsonParse('["a","b"]', [])).toEqual(['a', 'b']);
  });

  it('should return fallback for null', () => {
    expect(safeJsonParse(null, ['fallback'])).toEqual(['fallback']);
  });

  it('should return fallback for undefined', () => {
    expect(safeJsonParse(undefined, 'default')).toBe('default');
  });

  it('should return fallback for invalid JSON', () => {
    expect(safeJsonParse('not json {{{', [])).toEqual([]);
  });

  it('should return fallback for empty string', () => {
    expect(safeJsonParse('', 42)).toBe(42);
  });

  it('should parse objects', () => {
    const result = safeJsonParse<{ a: number }>('{"a": 1}', { a: 0 });
    expect(result.a).toBe(1);
  });
});
