/**
 * Telling what an ingredient is from how it is written: "kippendijen (met bot
 * en vel)" and "kippendij" are the same thing, "pasta" and "pastinaak" are
 * not. For comparing a recipe with a changed version of itself.
 */

// Words that describe or package a product, not what it is
const DESCRIBING = new Set([
  'uit', 'blik', 'pot', 'met', 'van', 'het', 'een', 'vers', 'verse', 'gedroogd', 'gedroogde', 'rode', 'gele', 'groene',
  'witte', 'zwarte', 'grote', 'kleine', 'fijne', 'grove', 'stuks', 'naar', 'smaak', 'bot', 'vel', 'zonder',
  'in', 'op', 'en', 'of', 'de', 'te', 'na', 'om',
]);

/**
 * The words that say what an ingredient is: "kippendijen (met bot en vel)" →
 * kippendijen, "kleine ui (heel fijn gesneden)" → ui, "ui, gesnipperd" → ui.
 * What is between brackets or after a comma is how it is prepared.
 */
export function keyWords(name: string): string[] {
  return name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(',')[0]
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/).filter((w) => w.length >= 2 && !DESCRIBING.has(w));
}

/** Edit distance, for telling a typo from another word. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * The plural and diminutive forms of a Dutch word: tomaat → tomaten, kip →
 * kippen, ui → uien / uitjes, ei → eieren, druif → druiven. Spelled out rather
 * than a looser prefix, which would take pasta for pastinaak.
 */
function pluralForms(word: string): string[] {
  const forms = ['s', "'s", 'n', 'en', 'eren', 'jes', 'tjes', 'pjes'].map((ending) => word + ending);
  // A short vowel: the consonant doubles (kip → kippen)
  forms.push(word + word.slice(-1) + 'en');
  // A long vowel written double before the last consonant loses one (tomaat → tomaten, boon → bonen)
  const long = word.match(/^(.*)(aa|ee|oo|uu)([^aeiou])$/);
  if (long) forms.push(`${long[1]}${long[2][0]}${long[3]}en`);
  // f → v, s → z (druif → druiven, radijs → radijzen)
  if (word.endsWith('f')) forms.push(`${word.slice(0, -1)}ven`);
  if (word.endsWith('s')) forms.push(`${word.slice(0, -1)}zen`);
  return forms;
}

/**
 * The same word: also in plural ("kippendij", "kippendijen"; "tomaat",
 * "tomaten"; "ui", "uien"), as the start of a longer name ("paprika" in
 * "paprikapoeder"), or with a one-letter typo in a long word
 * ("worchestershiresaus"). Different foods stay apart: pasta and pastinaak,
 * kokosmelk and kokosmeel.
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (pluralForms(short).includes(long)) return true;
  if (short.length >= 4 && long.startsWith(short)) return true;
  return short.length >= 8 && distance(short, long) <= 1;
}
