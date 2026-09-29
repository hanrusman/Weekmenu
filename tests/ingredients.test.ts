import { describe, it, expect } from 'vitest';
import {
  normalizeName,
  normalizeUnit,
  parseAmount,
  formatAmount,
  formatQuantity,
  normalizeIngredient,
} from '../server/services/ingredients';

describe('normalizeName', () => {
  it('lowercases and trims', () => {
    expect(normalizeName('  Courgette ')).toBe('courgette');
  });

  it('collapses whitespace', () => {
    expect(normalizeName('rode  paprika')).toBe('rode paprika');
  });

  it('maps Dutch plural synonyms to a canonical name', () => {
    expect(normalizeName('uien')).toBe('ui');
    expect(normalizeName('Uien')).toBe('ui');
    expect(normalizeName('tomaten')).toBe('tomaat');
    expect(normalizeName('eieren')).toBe('ei');
    expect(normalizeName('aardappelen')).toBe('aardappel');
  });

  it('maps knoflook variants to knoflook', () => {
    expect(normalizeName('teentje knoflook')).toBe('knoflook');
    expect(normalizeName('knoflookteentjes')).toBe('knoflook');
  });

  it('keeps unknown names as-is (lowercased)', () => {
    expect(normalizeName('Harissa')).toBe('harissa');
  });
});

describe('normalizeUnit', () => {
  it('converts kg to g with factor 1000', () => {
    expect(normalizeUnit('kg')).toMatchObject({ unit: 'g', factor: 1000 });
  });

  it('converts liter to ml with factor 1000', () => {
    expect(normalizeUnit('liter')).toMatchObject({ unit: 'ml', factor: 1000 });
    expect(normalizeUnit('l')).toMatchObject({ unit: 'ml', factor: 1000 });
    expect(normalizeUnit('dl')).toMatchObject({ unit: 'ml', factor: 100 });
  });

  it('maps spelled-out spoons to el/tl', () => {
    expect(normalizeUnit('eetlepel').unit).toBe('el');
    expect(normalizeUnit('eetlepels').unit).toBe('el');
    expect(normalizeUnit('theelepel').unit).toBe('tl');
  });

  it('maps stuk variants to stuks', () => {
    expect(normalizeUnit('stuk').unit).toBe('stuks');
    expect(normalizeUnit('st').unit).toBe('stuks');
  });

  it('maps teentje to teen', () => {
    expect(normalizeUnit('teentjes').unit).toBe('teen');
  });

  it('passes unknown units through lowercased', () => {
    expect(normalizeUnit('Schep')).toMatchObject({ unit: 'schep', factor: 1 });
  });
});

describe('parseAmount', () => {
  it('parses plain numbers and numeric strings', () => {
    expect(parseAmount(400)).toBe(400);
    expect(parseAmount('400')).toBe(400);
    expect(parseAmount('2.5')).toBe(2.5);
  });

  it('parses Dutch decimal comma', () => {
    expect(parseAmount('0,5')).toBe(0.5);
  });

  it('parses unicode and slash fractions', () => {
    expect(parseAmount('½')).toBe(0.5);
    expect(parseAmount('1½')).toBe(1.5);
    expect(parseAmount('1/2')).toBe(0.5);
    expect(parseAmount('3/4')).toBe(0.75);
  });

  it('resolves ranges to the upper bound', () => {
    expect(parseAmount('1-2')).toBe(2);
    expect(parseAmount('1 à 2')).toBe(2);
  });

  it('returns null for free text and empty values', () => {
    expect(parseAmount('naar smaak')).toBeNull();
    expect(parseAmount('')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe('formatAmount / formatQuantity', () => {
  it('formats integers without decimals', () => {
    expect(formatAmount(400)).toBe('400');
  });

  it('rounds to at most two decimals', () => {
    expect(formatAmount(1 / 3)).toBe('0.33');
  });

  it('joins multiple unit groups', () => {
    const byUnit = new Map<string, number>([['g', 400], ['el', 2]]);
    expect(formatQuantity(byUnit)).toBe('400 g, 2 el');
  });

  it('rounds count units up to whole numbers', () => {
    const byUnit = new Map<string, number>([['stuks', 2.5]]);
    expect(formatQuantity(byUnit)).toBe('3 stuks');
  });
});

describe('normalizeIngredient', () => {
  it('normalizes name, unit and amount together', () => {
    const norm = normalizeIngredient({ name: 'Uien', amount: '0,5', unit: 'kg', product_group: 'Groenten' });
    expect(norm).toEqual({
      name: 'ui',
      amount: 500,
      unit: 'g',
      product_group: 'groenten',
      raw_text: null,
      note: null,
    });
  });

  it('keeps unparseable amounts as raw text', () => {
    const norm = normalizeIngredient({ name: 'peper', amount: 'naar smaak', unit: '', product_group: 'kruiden' });
    expect(norm.amount).toBeNull();
    expect(norm.raw_text).toBe('naar smaak');
  });

  it('defaults missing product group to overig', () => {
    const norm = normalizeIngredient({ name: 'iets', amount: 1, unit: 'stuks', product_group: '' });
    expect(norm.product_group).toBe('overig');
  });
});

describe('annotation stripping', () => {
  it('moves parenthetical remarks from the name into the note', () => {
    const norm = normalizeIngredient({ name: 'Kikkererwten (blik, uitgelekt)', amount: 240, unit: 'g', product_group: 'droogwaren' });
    expect(norm.name).toBe('kikkererwten');
    expect(norm.note).toBe('blik, uitgelekt');
  });

  it('drops "uit blik" from the name', () => {
    expect(normalizeName('tomatenblokjes uit blik')).toBe('tomatenblokjes');
  });

  it('strips annotations and size words from units', () => {
    expect(normalizeUnit('stuks (ca. 300g)')).toMatchObject({ unit: 'stuks', notes: ['ca. 300g'] });
    expect(normalizeUnit('grote krop (ca. 800g)').unit).toBe('krop');
    expect(normalizeUnit('klein potje').unit).toBe('pot');
    expect(normalizeUnit('blikken').unit).toBe('blik');
    expect(normalizeUnit('tsp').unit).toBe('tl');
  });

  it('reads "à 400g" as a per-unit weight, but not "ca. 300g"', () => {
    expect(normalizeUnit('blikken (à 400g)').perUnit).toEqual({ amount: 400, unit: 'g' });
    expect(normalizeUnit('blik (à 0,4 kg)').perUnit).toEqual({ amount: 400, unit: 'g' });
    expect(normalizeUnit('stuks (ca. 300g)').perUnit).toBeUndefined();
  });

  it('treats a bare count as pieces', () => {
    expect(normalizeIngredient({ name: 'ui', amount: 1, unit: 'grote', product_group: 'groenten' }).unit).toBe('stuks');
    expect(normalizeIngredient({ name: 'ui', amount: 2, unit: '', product_group: 'groenten' }).unit).toBe('stuks');
  });
});

describe('aliases', () => {
  it('resolves names through a provided alias map before the seed list', () => {
    const aliases = new Map([['winterpeen', 'bospeen']]);
    expect(normalizeName('Winterpeen', aliases)).toBe('bospeen');
    expect(normalizeName('winterwortelen', aliases)).toBe('wortel');
  });
});
