import { describe, it, expect } from 'vitest';
import { splitRecipes, looksLikeRecipe, MAX_RECIPE_CHARS } from '../server/services/recipe-split';

const cookbook = `# Snel en simpel

Een inleiding over het boek, zonder recepten.

### Inhoud
- [Soepen](#soepen)
- [Pasta](#pasta)

## Soepen

Soep is altijd goed. In 2 stappen klaar, voor 4 mensen.

### Tomatensoep
- 1 ui
- 800 g tomaten
- snufje zout

1. Fruit de ui.
2. Kook de tomaten 20 minuten.

### Erwtensoep
- 500 g spliterwten
- 1 **winterwortel**

1. Alles 2 uur koken.

## Pasta

### [Pasta pesto](https://example.com)
- 400 g pasta
- 1 potje pesto

Kook de pasta.
`;

describe('splitRecipes', () => {
  it('finds recipes under chapters and skips contents, introduction and chapter openers', () => {
    const candidates = splitRecipes(cookbook);
    expect(candidates.map((c) => c.title)).toEqual(['Tomatensoep', 'Erwtensoep', 'Pasta pesto']);
    expect(candidates[0].text).toBe('### Tomatensoep\n- 1 ui\n- 800 g tomaten\n- snufje zout\n\n1. Fruit de ui.\n2. Kook de tomaten 20 minuten.');
    // A recipe ends at the next chapter, not only at the next recipe
    expect(candidates[1].text).not.toContain('## Pasta');
  });

  it('keeps sub-headings inside a recipe together', () => {
    const md = `## Stamppot
#### Ingrediënten
- 1 kg aardappelen
- 500 g boerenkool
#### Bereiding
1. Kook alles gaar.
2. Stampen.

## Hutspot
#### Ingrediënten
- 1 kg aardappelen
- 750 g winterpeen
#### Bereiding
1. Koken en stampen.
`;
    const candidates = splitRecipes(md);
    expect(candidates.map((c) => c.title)).toEqual(['Stamppot', 'Hutspot']);
    expect(candidates[0].text).toContain('#### Bereiding');
    expect(candidates[0].text).toContain('2. Stampen.');
  });

  it('does not take numbered steps for an ingredient list', () => {
    expect(looksLikeRecipe(['1. Verhit de olie.', '2. Bak de ui.', '3. Serveer.'])).toBe(false);
    expect(looksLikeRecipe(['- 2 uien', '- 1 blik tomaten'])).toBe(true);
    expect(looksLikeRecipe(['Ingrediënten:', 'wat restjes'])).toBe(true);
    expect(looksLikeRecipe(['- [Soepen](#soepen)', '- [Pasta 2](#pasta-2)'])).toBe(false);
  });

  it('treats a file without headings as one recipe', () => {
    expect(splitRecipes('Pannenkoeken\n\n- 250 g bloem\n- 2 eieren\n- 500 ml melk\n')).toEqual([
      { title: 'Pannenkoeken', text: 'Pannenkoeken\n\n- 250 g bloem\n- 2 eieren\n- 500 ml melk' },
    ]);
    expect(splitRecipes('Alleen wat tekst over koken.')).toEqual([]);
  });

  it('caps a very long section', () => {
    const md = `## Groot recept\n- 1 ui\n- 2 tomaten\n${'x'.repeat(MAX_RECIPE_CHARS)}`;
    expect(splitRecipes(md)[0].text).toHaveLength(MAX_RECIPE_CHARS);
  });
});
