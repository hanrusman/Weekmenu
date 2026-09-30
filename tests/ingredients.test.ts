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
      variant: 'uien',
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

describe('annotation handling in names', () => {
  it('moves remarks that do not affect what you buy into the note', () => {
    const norm = normalizeIngredient({ name: 'Olijfolie (voor salade)', amount: 2, unit: 'el', product_group: 'olie' });
    expect(norm.name).toBe('olijfolie');
    expect(norm.note).toBe('voor salade');
    expect(normalizeName('parmezaan (optioneel)')).toBe('parmezaan');
    expect(normalizeName('pizzadeeg (vers of zelfgemaakt)')).toBe('pizzadeeg');
  });

  it('spells packaging one way, keeping canned apart from dried', () => {
    expect(normalizeName('kikkererwten (blik)')).toBe('kikkererwten uit blik');
    expect(normalizeName('kikkererwten uit blik')).toBe('kikkererwten uit blik');
    const drained = normalizeIngredient({ name: 'kikkererwten (blik, uitgelekt)', amount: 240, unit: 'g', product_group: 'droogwaren' });
    expect(drained.name).toBe('kikkererwten uit blik');
    expect(drained.note).toBe('uitgelekt');
    expect(normalizeName('rode linzen (blik)')).not.toBe(normalizeName('rode linzen'));
  });

  it('keeps frozen apart from fresh', () => {
    expect(normalizeName('garnalen (diepvries)')).toBe('diepvries garnalen');
    expect(normalizeName('diepvries garnalen')).toBe('diepvries garnalen');
    expect(normalizeName('garnalen')).toBe('garnalen');
  });

  it('keeps remarks that name a different product', () => {
    expect(normalizeName('paprika (gerookt)')).toBe('paprika (gerookt)');
    expect(normalizeName('paprika (gerookt)')).not.toBe(normalizeName('paprika'));
    expect(normalizeName('tomaten (zongedroogd)')).not.toBe(normalizeName('tomaten'));
    expect(normalizeName('sla (little gem of ijsberg)')).toBe('sla (little gem of ijsberg)');
  });

  it('only drops numbers that are an amount, weight or volume', () => {
    expect(normalizeName('tomaten (ca. 300g)')).toBe(normalizeName('tomaten'));
    expect(normalizeName('kipfilet (4 x 80g)')).toBe('kipfilet');
    expect(normalizeName('melk (0,5 l)')).toBe('melk');
    expect(normalizeIngredient({ name: 'melk (0,5 l)', amount: 1, unit: 'pak', product_group: 'zuivel' }).note).toBe('0,5 l');
    expect(normalizeName('eieren (2 stuks)')).toBe('ei');
    expect(normalizeName('chocolade (70% cacao)')).toBe('chocolade (70% cacao)');
    expect(normalizeName('chocolade (70% cacao)')).not.toBe(normalizeName('chocolade'));
  });

  it('keeps decimal commas inside a remark together', () => {
    expect(normalizeName('melk (1,5% vet)')).toBe('melk (1,5% vet)');
    expect(normalizeName('yoghurt (3,5% vet)')).toBe('yoghurt (3,5% vet)');
    expect(normalizeName('melk (1,5% vet, biologisch)')).toBe('melk (1,5% vet, biologisch)');
    expect(normalizeName('kaas (1,5 kg, belegen)')).toBe('kaas (belegen)');
    const drained = normalizeIngredient({ name: 'kikkererwten (blik,uitgelekt)', amount: 1, unit: 'blik', product_group: 'droogwaren' });
    expect(drained.name).toBe('kikkererwten uit blik');
    expect(drained.note).toBe('uitgelekt');
  });

  it('only drops sourcing remarks that are a choice between options', () => {
    expect(normalizeName('pasta (vers)')).toBe('pasta (vers)');
    expect(normalizeName('pasta (vers)')).not.toBe(normalizeName('pasta'));
    expect(normalizeName('falafel (kant-en-klaar)')).toBe('falafel (kant-en-klaar)');
    expect(normalizeName('pizzadeeg (zelfgemaakt of kant-en-klaar)')).toBe('pizzadeeg');
  });
});

describe('annotation handling in units', () => {
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
  it('uses only the provided alias map, so aliases removed in the app stay removed', () => {
    const aliases = new Map([['winterpeen', 'bospeen']]);
    expect(normalizeName('Winterpeen', aliases)).toBe('bospeen');
    expect(normalizeName('winterwortelen', aliases)).toBe('winterwortelen');
  });

  it('falls back to the seed list without an alias map', () => {
    expect(normalizeName('winterwortelen')).toBe('wortel');
  });
});
