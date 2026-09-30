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

  it('does not strip size words, which change the weight per piece', () => {
    expect(defaultFactor('kleine courgette', 'stuks', 'g')).toBeUndefined();
    expect(defaultFactor('grote ui', 'stuks', 'g')).toBeUndefined();
    expect(defaultFactor('jonge spinazie', 'zak', 'g')).toBeUndefined();
  });

  it('looks up the name as written first, then the ingredient, then agreeing aliases', () => {
    // A variety weighs differently from the canonical ingredient it is an alias of
    expect(defaultFactor({ variant: 'winterpeen', name: 'wortel' }, 'stuks', 'g')).toBe(200);
    expect(defaultFactor({ variant: 'wortelen', name: 'wortel' }, 'stuks', 'g')).toBe(100);
    // After a rename the old name, now an alias, still carries the weight
    expect(defaultFactor({ name: 'tomaten', aliases: ['tomaat'] }, 'stuks', 'g')).toBe(100);
    // Aliases that disagree give no weight rather than a guess
    expect(defaultFactor({ name: 'peen', aliases: ['wortel', 'winterpeen'] }, 'stuks', 'g')).toBeUndefined();
  });

  it('knows nothing about other ingredients or units', () => {
    expect(defaultFactor('koolrabi', 'stuks', 'g')).toBeUndefined();
    expect(defaultFactor('aubergine', 'pot', 'g')).toBeUndefined();
    expect(defaultFactor('aubergine', 'stuks', 'stuks')).toBeUndefined();
    expect(defaultFactor('ui', 'el', 'g')).toBeUndefined();
  });
});

describe('tins', () => {
  it('hold 400 g by default, in both directions', () => {
    expect(defaultFactor('tomatenblokjes uit blik', 'blik', 'g')).toBe(400);
    expect(defaultFactor('gepelde tomaten', 'g', 'blik')).toBe(1 / 400);
    // The unit already says it is a tin, whatever the name
    expect(defaultFactor('kikkererwten', 'blik', 'g')).toBe(400);
  });

  it('hold millilitres for liquids, including water measured with the tin', () => {
    expect(defaultFactor('kokosmelk', 'ml', 'blik')).toBe(1 / 400);
    expect(defaultFactor('water', 'blik', 'ml')).toBe(400);
  });

  it('know the common smaller tins, as written or after the packaging and colour words', () => {
    expect(defaultFactor('maïs uit blik', 'g', 'blik')).toBe(1 / 300);
    expect(defaultFactor('tonijn uit blik', 'blik', 'g')).toBe(160);
    expect(defaultFactor('tonijn in olijfolie uit blik', 'blik', 'g')).toBe(160);
    expect(defaultFactor('tomatenpuree', 'blik', 'g')).toBe(70);
    expect(defaultFactor('ansjovisfilets in blik', 'blik', 'g')).toBe(50);
  });

  it('use the name as written, then the ingredient, then agreeing aliases', () => {
    expect(defaultFactor({ variant: 'tonijn in olijfolie uit blik', name: 'vis uit blik' }, 'blik', 'g')).toBe(160);
    expect(defaultFactor({ name: 'tonijnstukken', aliases: ['tonijn uit blik'] }, 'blik', 'g')).toBe(160);
    expect(defaultFactor({ name: 'vis uit blik', aliases: ['tonijn uit blik', 'sardines uit blik'] }, 'blik', 'g')).toBe(400);
  });

  it('relate only to grams and millilitres', () => {
    expect(defaultFactor('tomatenblokjes uit blik', 'blik', 'stuks')).toBeUndefined();
    expect(defaultFactor('kokosmelk', 'blik', 'el')).toBeUndefined();
    expect(defaultFactor('tomatenblokjes uit blik', 'blik', 'blik')).toBeUndefined();
  });
});
