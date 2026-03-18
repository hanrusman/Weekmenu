import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentSeason, getSeasonalVegetables } from '../server/prompts/seasonal';

describe('Seasonal utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return lente for March', () => {
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(2); // March = 2
    expect(getCurrentSeason()).toBe('lente');
  });

  it('should return zomer for June', () => {
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(5); // June = 5
    expect(getCurrentSeason()).toBe('zomer');
  });

  it('should return herfst for October', () => {
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(9); // October = 9
    expect(getCurrentSeason()).toBe('herfst');
  });

  it('should return winter for January', () => {
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(0); // January = 0
    expect(getCurrentSeason()).toBe('winter');
  });

  it('should return winter for December', () => {
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(11);
    expect(getCurrentSeason()).toBe('winter');
  });

  it('should return seasonal vegetables for lente', () => {
    const vegs = getSeasonalVegetables('lente');
    expect(vegs).toContain('asperges');
    expect(vegs).toContain('spinazie');
    expect(vegs.length).toBeGreaterThan(5);
  });

  it('should return seasonal vegetables for zomer', () => {
    const vegs = getSeasonalVegetables('zomer');
    expect(vegs).toContain('courgette');
    expect(vegs).toContain('tomaat');
  });

  it('should return seasonal vegetables for herfst', () => {
    const vegs = getSeasonalVegetables('herfst');
    expect(vegs).toContain('pompoen');
    expect(vegs).toContain('spruitjes');
  });

  it('should return seasonal vegetables for winter', () => {
    const vegs = getSeasonalVegetables('winter');
    expect(vegs).toContain('boerenkool');
    expect(vegs).toContain('witlof');
  });

  it('should use current season when no argument passed', () => {
    const vegs = getSeasonalVegetables();
    expect(vegs.length).toBeGreaterThan(0);
  });
});
