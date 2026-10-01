/**
 * Split a markdown cookbook into candidate recipes, one per heading.
 *
 * Cookbooks put recipes at different heading levels (## in one, ### under
 * chapter headings in another) and may use sub-headings inside a recipe
 * ("#### Ingrediënten"). So the recipe level is chosen as the heading level
 * whose sections most often look like a recipe, and a section runs until the
 * next heading of that level or higher. Sections without ingredients — table
 * of contents, introductions, chapter openers — are left out.
 */

export interface RecipeCandidate {
  title: string;
  /** The recipe's own markdown, heading included. */
  text: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
// The line under a setext heading: === for level 1, --- for level 2
const SETEXT_UNDERLINE = /^ {0,3}(=+|-{2,})\s*$/;
// Lines that cannot be the text of a setext heading: blank, a heading, list
// item, quote, table row, code fence or indented code
const NOT_HEADING_TEXT = /^\s*$|^ {0,3}(?:#|>|\||```|~~~)|^\s*(?:[-*+•]|\d+[.)])\s|^ {4}/;
// A list item that is only a link, as in a generated table of contents
const LINK_ONLY_ITEM = /^\s*(?:[-*+•]|\d+\.)\s*\[[^\]]*\]\([^)]*\)\s*$/;
const LIST_MARKER = /^\s*(?:[-*+•]|\d+[.)])\s+(?=\S)/;
const QUANTITY = /\d|[½¼¾⅓⅔]|\b(?:snufje|scheutje?|handje|naar smaak|takje|teentjes?|blikje?|bosje?)\b/i;
const INGREDIENTS_LABEL = /ingredi[eë]nt|benodigdheden|je hebt nodig|nodig:/i;

/** Longest recipe section that is still sent to the parser in one piece. */
export const MAX_RECIPE_CHARS = 20_000;

interface Section {
  level: number;
  title: string;
  lines: string[];
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/[*_`~]+/g, '') // emphasis
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether a block of lines reads like a recipe: a list with quantities, or an ingredients label. */
export function looksLikeRecipe(lines: string[]): boolean {
  const content = lines.filter((l) => !LINK_ONLY_ITEM.test(l));
  if (content.some((l) => INGREDIENTS_LABEL.test(l))) return true;
  // The quantity must be in the item itself, not its number ("1. Verhit de olie")
  return content.filter((l) => LIST_MARKER.test(l) && QUANTITY.test(l.replace(LIST_MARKER, ''))).length >= 2;
}

/**
 * Setext headings ("Titel" with a line of === or --- under it) as # headings,
 * so the rest only has to know one kind. Only a single-line title after a
 * blank line counts: --- after a blank line, a list or more text is a divider
 * or part of the text, and a block between --- lines at the top is front
 * matter (Obsidian), not a heading.
 */
export function withAtxHeadings(lines: string[]): string[] {
  const out = [...lines];
  let start = 0;
  if (/^---\s*$/.test(lines[0] ?? '')) {
    const end = lines.findIndex((l, i) => i > 0 && /^(?:---|\.\.\.)\s*$/.test(l));
    if (end > 0) start = end + 1;
  }
  for (let i = start + 1; i < lines.length; i++) {
    // Read from what is already converted: an underline just used is a blank line there
    const underline = out[i].match(SETEXT_UNDERLINE);
    const text = out[i - 1];
    const before = i - 2 >= start ? out[i - 2] : '';
    if (!underline || NOT_HEADING_TEXT.test(text) || (before.trim() && !HEADING.test(before))) continue;
    out[i - 1] = `${underline[1][0] === '=' ? '#' : '##'} ${text.trim()}`;
    out[i] = '';
  }
  return out;
}

/** Sections that start at a heading of exactly `level` and run until the next heading of that level or higher. */
function sectionsAt(lines: string[], level: number): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  for (const line of lines) {
    const m = line.match(HEADING);
    if (m && m[1].length <= level) {
      current = m[1].length === level ? { level, title: cleanTitle(m[2]), lines: [line] } : null;
      if (current) sections.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return sections;
}

export function splitRecipes(markdown: string): RecipeCandidate[] {
  const lines = withAtxHeadings(markdown.replace(/\r\n?/g, '\n').split('\n'));
  const levels = [...new Set(lines.map((l) => l.match(HEADING)?.[1].length).filter((n): n is number => n !== undefined))];

  // The level with the most recipe-like sections, counted by distinct title:
  // sub-headings inside recipes ("Ingrediënten" ten times) count once. On a
  // tie the deeper level, since a chapter holding recipes also looks like one.
  let best: Section[] = [];
  let bestScore = 0;
  for (const level of levels.sort((a, b) => a - b)) {
    const recipes = sectionsAt(lines, level).filter((s) => s.title && looksLikeRecipe(s.lines.slice(1)));
    const score = new Set(recipes.map((s) => s.title.toLowerCase())).size;
    if (score > 0 && score >= bestScore) {
      best = recipes;
      bestScore = score;
    }
  }

  // A file without headings may still be a single recipe
  if (best.length === 0 && levels.length === 0 && looksLikeRecipe(lines)) {
    const firstLine = lines.find((l) => l.trim())?.trim() ?? 'Recept';
    return [{ title: cleanTitle(firstLine).slice(0, 200), text: markdown.trim().slice(0, MAX_RECIPE_CHARS) }];
  }

  return best.map((s) => ({
    title: s.title.slice(0, 200),
    text: s.lines.join('\n').trim().slice(0, MAX_RECIPE_CHARS),
  }));
}
