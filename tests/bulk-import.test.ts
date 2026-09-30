import { describe, it, expect } from 'vitest';
import { detectFormat, recipesFromJson } from '../client/src/lib/bulkImport';

describe('bulk import file format', () => {
  it('reads a markdown file as markdown, even when it starts like JSON', () => {
    expect(detectFormat('Kookboek.md', '[[Kookboek]]\n\n## Soep\n- 1 ui')).toBe('markdown');
    expect(detectFormat('Kookboek.MD', '[Terug naar inhoud](#inhoud)\n## Soep')).toBe('markdown');
    expect(detectFormat('recepten.txt', '[{"name": "x"}]')).toBe('markdown');
    expect(detectFormat('boek.markdown', '{ niet echt json')).toBe('markdown');
  });

  it('reads a .json file as JSON', () => {
    expect(detectFormat('van-claude.json', '[]')).toBe('json');
    expect(detectFormat('VAN-CLAUDE.JSON', 'kapot')).toBe('json'); // then the JSON reader reports the error
  });

  it('decides by content only without a known extension', () => {
    expect(detectFormat('recepten', '[{"name": "Soep"}]')).toBe('json');
    expect(detectFormat('recepten', '{"recipes": [{"name": "Soep"}]}')).toBe('json');
    expect(detectFormat('recepten', '[[Inhoud]]\n## Soep')).toBe('markdown');
    expect(detectFormat('recepten', '{"name": "geen lijst"}')).toBe('markdown');
  });

  it('takes an array or {"recipes": [...]} and explains anything else', () => {
    expect(recipesFromJson('[{"name": "A"}, null, 3, {"name": "B"}]')).toEqual([{ name: 'A' }, { name: 'B' }]);
    expect(recipesFromJson('{"recipes": [{"name": "A"}]}')).toEqual([{ name: 'A' }]);
    expect(() => recipesFromJson('[[Kookboek]]')).toThrow(/geen geldige JSON/);
    expect(() => recipesFromJson('{"name": "A"}')).toThrow(/JSON-array/);
  });
});
