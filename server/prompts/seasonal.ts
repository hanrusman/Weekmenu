const seasonalVegetables: Record<string, string[]> = {
  lente: [
    'asperges', 'radijs', 'spinazie', 'prei', 'rabarber',
    'tuinbonen', 'lente-ui', 'sla', 'snijbiet', 'nieuwe aardappelen',
    'aardbei', 'peterselie', 'bieslook', 'venkel',
  ],
  zomer: [
    'courgette', 'tomaat', 'paprika', 'aubergine', 'komkommer',
    'sperziebonen', 'doperwten', 'mais', 'broccoli', 'bloemkool',
    'bosbessen', 'frambozen', 'perzik', 'sla', 'watermeloen',
    'basilicum', 'munt', 'dille',
  ],
  herfst: [
    'pompoen', 'butternut', 'pastinaak', 'knolselderij', 'biet',
    'boerenkool', 'spruitjes', 'prei', 'champignon', 'peer',
    'kastanje', 'appel', 'zoete aardappel', 'wortel', 'kool',
    'rode kool', 'bleekselderij',
  ],
  winter: [
    'boerenkool', 'spruitjes', 'winterwortel', 'knolselderij',
    'pastinaak', 'rode kool', 'witte kool', 'prei', 'witlof',
    'aardappel', 'biet', 'ui', 'knoflook', 'winterpostelein',
    'veldsla', 'citrusvruchten',
  ],
};

export function getCurrentSeason(): string {
  const month = new Date().getMonth(); // 0-indexed
  if (month >= 2 && month <= 4) return 'lente';
  if (month >= 5 && month <= 7) return 'zomer';
  if (month >= 8 && month <= 10) return 'herfst';
  return 'winter';
}

export function getSeasonalVegetables(season?: string): string[] {
  const s = season || getCurrentSeason();
  return seasonalVegetables[s] || seasonalVegetables.lente;
}
