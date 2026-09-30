import { describe, it, expect } from 'vitest';
import { defaultFactor } from '../server/services/piece-weights';

describe('defaultFactor', () => {
  it('relates pieces and grams in both directions', () => {
    expect(defaultFactor('aubergine', 'stuks', 'g')).toBe(300);
    expect(defaultFactor('aubergine', 'g', 'stuks')).toBe(1 / 300);
  });

  it('relates other countable units of the same vegetable', () => {
    expect(defaultFactor('bloemkool', 'krop', 'stuks')).toBe(1);
    expect(defaultFactor('bosui', 'bos', 'stuks')).toBeCloseTo(100 / 15);
    expect(defaultFactor('knoflook', 'bol', 'teen')).toBe(10);
    expect(defaultFactor('bleekselderij', 'stengel', 'g')).toBe(40);
  });

  it('falls back to the product when a colour or freshness word is added', () => {
    expect(defaultFactor('rode paprika', 'stuks', 'g')).toBe(150);
    expect(defaultFactor('Gele Paprika', 'g', 'stuks')).toBe(1 / 150);
    expect(defaultFactor('verse spinazie', 'zak', 'g')).toBe(300);
    expect(defaultFactor('verse gember', 'cm', 'g')).toBe(5);
  });

  it('keeps distinct products apart', () => {
    expect(defaultFactor('rode kool', 'stuks', 'g')).toBe(1000);
    expect(defaultFactor('cherrytomaat', 'stuks', 'g')).toBe(15);
    expect(defaultFactor('tomaat', 'stuks', 'g')).toBe(100);
  });

  it('knows nothing about other ingredients or units', () => {
    expect(defaultFactor('koolrabi', 'stuks', 'g')).toBeUndefined();
    expect(defaultFactor('aubergine', 'blik', 'g')).toBeUndefined();
    expect(defaultFactor('aubergine', 'stuks', 'stuks')).toBeUndefined();
    expect(defaultFactor('ui', 'el', 'g')).toBeUndefined();
  });
});
