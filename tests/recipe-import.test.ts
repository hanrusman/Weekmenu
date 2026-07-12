import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isBlockedAddress,
  extractJsonLdRecipe,
  mapSchemaRecipeToDraft,
  stripJsonFence,
  htmlToText,
  extractRecipeViaLlm,
} from '../server/services/recipe-import';
import { parseIngredientLine, classifyProductGroup } from '../server/services/ingredients';

describe('parseIngredientLine', () => {
  it('parses amount + unit + name', () => {
    expect(parseIngredientLine('400 g penne')).toEqual({
      name: 'penne', amount: '400', unit: 'g', product_group: 'droogwaren',
    });
  });

  it('parses spoon units', () => {
    expect(parseIngredientLine('2 el olijfolie')).toEqual({
      name: 'olijfolie', amount: '2', unit: 'el', product_group: 'olie',
    });
  });

  it('keeps adjectives in the name when the second word is not a unit', () => {
    expect(parseIngredientLine('1 rode ui')).toEqual({
      name: 'rode ui', amount: '1', unit: '', product_group: 'groenten',
    });
  });

  it('parses unicode fractions', () => {
    expect(parseIngredientLine('½ komkommer')).toEqual({
      name: 'komkommer', amount: '½', unit: '', product_group: 'groenten',
    });
  });

  it('parses a unit without an amount', () => {
    expect(parseIngredientLine('snufje zout')).toEqual({
      name: 'zout', amount: '', unit: 'snufje', product_group: 'kruiden',
    });
  });

  it('passes through lines without amount or unit', () => {
    expect(parseIngredientLine('peper en zout naar smaak')).toEqual({
      name: 'peper en zout naar smaak', amount: '', unit: '', product_group: 'kruiden',
    });
  });

  it('drops parentheticals', () => {
    expect(parseIngredientLine('1 blik tomatenblokjes (400 g)')).toEqual({
      name: 'tomatenblokjes', amount: '1', unit: 'blik', product_group: 'groenten',
    });
  });

  it('parses ranges', () => {
    expect(parseIngredientLine('1-2 teentjes knoflook')).toEqual({
      name: 'knoflook', amount: '1-2', unit: 'teentjes', product_group: 'groenten',
    });
  });
});

describe('classifyProductGroup', () => {
  it.each([
    ['courgette', 'groenten'],
    ['appel', 'fruit'],
    ['zalmfilet', 'vis'],
    ['kipfilet', 'vlees'],
    ['geraspte kaas', 'zuivel'],
    ['volkoren spaghetti', 'droogwaren'],
    ['gedroogde oregano', 'kruiden'],
    ['olijfolie', 'olie'],
    ['sojasaus', 'sauzen'],
    ['stokbrood', 'brood'],
    ['exotisch iets', 'overig'],
  ])('classifies %s as %s', (name, group) => {
    expect(classifyProductGroup(name)).toBe(group);
  });

  it('prefers the longest keyword match', () => {
    expect(classifyProductGroup('paprikapoeder')).toBe('kruiden');
    expect(classifyProductGroup('paprika')).toBe('groenten');
  });
});

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.2.46', '169.254.1.1',
    '100.108.106.21', '0.0.0.0', 'localhost', 'server.local', '::1', 'fd7a::1',
    '::ffff:192.168.1.1',
  ])('blocks %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(['142.250.179.163', '1.1.1.1', 'ah.nl', '2a00:1450:400e:80e::200e'])('allows %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(false);
  });
});

const RECIPE_NODE = {
  '@type': 'Recipe',
  name: 'Pasta pesto',
  recipeYield: '4 personen',
  recipeIngredient: ['400 g penne', '100 g pesto'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Kook de pasta' },
    { '@type': 'HowToStep', text: 'Meng met pesto' },
  ],
  nutrition: { calories: '450 kcal', proteinContent: '18 g', fiberContent: '6 g' },
  keywords: 'pasta, snel',
};

function page(jsonLd: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head><body></body></html>`;
}

describe('extractJsonLdRecipe', () => {
  it('finds a single Recipe object', () => {
    const node = extractJsonLdRecipe(page(RECIPE_NODE));
    expect(node?.name).toBe('Pasta pesto');
  });

  it('finds a Recipe in an array root', () => {
    const node = extractJsonLdRecipe(page([{ '@type': 'WebSite' }, RECIPE_NODE]));
    expect(node?.name).toBe('Pasta pesto');
  });

  it('finds a Recipe in an @graph wrapper (AH/Jumbo style)', () => {
    const node = extractJsonLdRecipe(page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization' }, RECIPE_NODE] }));
    expect(node?.name).toBe('Pasta pesto');
  });

  it('accepts @type arrays', () => {
    const node = extractJsonLdRecipe(page({ ...RECIPE_NODE, '@type': ['Recipe', 'Thing'] }));
    expect(node?.name).toBe('Pasta pesto');
  });

  it('skips malformed blocks and keeps searching', () => {
    const html = `<script type="application/ld+json">{not json</script>${page(RECIPE_NODE)}`;
    expect(extractJsonLdRecipe(html)?.name).toBe('Pasta pesto');
  });

  it('returns null when no recipe is present', () => {
    expect(extractJsonLdRecipe(page({ '@type': 'WebSite' }))).toBeNull();
    expect(extractJsonLdRecipe('<html><body>niets</body></html>')).toBeNull();
  });
});

describe('mapSchemaRecipeToDraft', () => {
  it('maps a complete recipe node', () => {
    const draft = mapSchemaRecipeToDraft(RECIPE_NODE as never, 'https://example.com/r');
    expect(draft.name).toBe('Pasta pesto');
    expect(draft.source).toBe('https://example.com/r');
    expect(draft.recipe_data.servings).toBe(4);
    expect(draft.recipe_data.ingredients).toEqual([
      { name: 'penne', amount: '400', unit: 'g', product_group: 'droogwaren' },
      { name: 'pesto', amount: '100', unit: 'g', product_group: 'sauzen' },
    ]);
    expect(draft.recipe_data.steps).toEqual(['Kook de pasta', 'Meng met pesto']);
    expect(draft.recipe_data.nutrition_per_serving).toEqual({ calories: 450, protein_g: 18, fiber_g: 6, iron_mg: 0 });
    expect(draft.tags).toEqual(['pasta', 'snel']);
    expect(draft.warnings).toEqual([]);
  });

  it('handles instructions as plain string and HowToSection', () => {
    const stringSteps = mapSchemaRecipeToDraft({ ...RECIPE_NODE, recipeInstructions: 'Kook.\nMeng.' } as never, 'u');
    expect(stringSteps.recipe_data.steps).toEqual(['Kook.', 'Meng.']);

    const sections = mapSchemaRecipeToDraft({
      ...RECIPE_NODE,
      recipeInstructions: [{
        '@type': 'HowToSection',
        itemListElement: [{ '@type': 'HowToStep', text: 'Stap uit sectie' }],
      }],
    } as never, 'u');
    expect(sections.recipe_data.steps).toEqual(['Stap uit sectie']);
  });

  it('warns on missing nutrition and defaults to zeros', () => {
    const { nutrition, ...rest } = RECIPE_NODE;
    const draft = mapSchemaRecipeToDraft(rest as never, 'u');
    expect(draft.recipe_data.nutrition_per_serving).toEqual({ calories: 0, protein_g: 0, fiber_g: 0, iron_mg: 0 });
    expect(draft.warnings).toContain('Voedingswaarden niet gevonden — vul zelf aan');
  });

  it('strips HTML from step text', () => {
    const draft = mapSchemaRecipeToDraft({
      ...RECIPE_NODE,
      recipeInstructions: [{ '@type': 'HowToStep', text: 'Kook de <b>pasta</b> &amp; roer' }],
    } as never, 'u');
    expect(draft.recipe_data.steps).toEqual(['Kook de pasta & roer']);
  });
});

describe('stripJsonFence', () => {
  it('strips ```json fences', () => {
    expect(stripJsonFence('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it('strips prose around the JSON object', () => {
    expect(stripJsonFence('Hier is het recept:\n{"a": 1}\nSucces!')).toBe('{"a": 1}');
  });

  it('leaves clean JSON untouched', () => {
    expect(stripJsonFence('{"a": 1}')).toBe('{"a": 1}');
  });
});

describe('htmlToText', () => {
  it('drops scripts, styles and tags', () => {
    const text = htmlToText('<html><script>x()</script><style>a{}</style><p>Recept &amp; meer</p></html>');
    expect(text).not.toContain('x()');
    expect(text).toContain('Recept');
  });
});

describe('extractRecipeViaLlm', () => {
  const LLM_JSON = {
    name: 'Nasi',
    servings: 4,
    ingredients: [{ name: 'rijst', amount: '300', unit: 'g', product_group: 'droogwaren' }],
    steps: ['Kook de rijst'],
    nutrition_per_serving: { calories: 500, protein_g: 22, fiber_g: 5, iron_mg: 3 },
    tags: ['rijst'],
  };

  function llmResponse(message: Record<string, unknown>) {
    return {
      ok: true,
      json: async () => ({ choices: [{ message }] }),
    } as unknown as Response;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('throws a clear error when the proxy is not configured', async () => {
    vi.stubEnv('LITELLM_URL', '');
    vi.stubEnv('LITELLM_MASTER_KEY', '');
    await expect(extractRecipeViaLlm('<html></html>', 'u')).rejects.toThrow('LLM-fallback niet geconfigureerd');
  });

  it('parses fenced JSON output', async () => {
    vi.stubEnv('LITELLM_URL', 'http://litellm.test');
    vi.stubEnv('LITELLM_MASTER_KEY', 'sk-test');
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse({ content: '```json\n' + JSON.stringify(LLM_JSON) + '\n```' })));

    const draft = await extractRecipeViaLlm('<html>recept</html>', 'https://example.com');
    expect(draft.name).toBe('Nasi');
    expect(draft.recipe_data.ingredients[0].name).toBe('rijst');
    expect(draft.warnings[0]).toContain('AI');
  });

  it('falls back to reasoning_content when content is empty', async () => {
    vi.stubEnv('LITELLM_URL', 'http://litellm.test');
    vi.stubEnv('LITELLM_MASTER_KEY', 'sk-test');
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse({ content: '', reasoning_content: JSON.stringify(LLM_JSON) })));

    const draft = await extractRecipeViaLlm('<html>recept</html>', 'u');
    expect(draft.name).toBe('Nasi');
  });

  it('normalizes unknown product groups to overig', async () => {
    vi.stubEnv('LITELLM_URL', 'http://litellm.test');
    vi.stubEnv('LITELLM_MASTER_KEY', 'sk-test');
    const weird = { ...LLM_JSON, ingredients: [{ name: 'x', amount: '1', unit: '', product_group: 'verzonnen' }] };
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse({ content: JSON.stringify(weird) })));

    const draft = await extractRecipeViaLlm('<html>recept</html>', 'u');
    expect(draft.recipe_data.ingredients[0].product_group).toBe('overig');
  });

  it('throws when the LLM returns unusable JSON', async () => {
    vi.stubEnv('LITELLM_URL', 'http://litellm.test');
    vi.stubEnv('LITELLM_MASTER_KEY', 'sk-test');
    vi.stubGlobal('fetch', vi.fn(async () => llmResponse({ content: 'geen json hier' })));

    await expect(extractRecipeViaLlm('<html></html>', 'u')).rejects.toThrow('LLM kon geen recept');
  });
});
