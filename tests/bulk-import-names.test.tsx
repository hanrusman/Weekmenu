import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = {
  getParserStatus: vi.fn().mockResolvedValue({ configured: true }),
  getRecipes: vi.fn(),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
}));

const { default: RecipeBulkImport } = await import('../client/src/pages/RecipeBulkImport');

describe('bulk import against the library', () => {
  it('knows a recipe whose name differs only in case and Unicode spelling', async () => {
    api.getRecipes.mockResolvedValue({
      recipes: [{ name: 'Crème brûlée' }], counts: { concept: 1, goedgekeurd: 0, archief: 0 },
    });
    render(<MemoryRouter><RecipeBulkImport /></MemoryRouter>);
    // Accents as combining characters (NFD), as macOS writes them
    const recipes = [{ name: 'CRE\u0300ME BRU\u0302LE\u0301E', ingredients: [{ name: 'room', amount: 500, unit: 'ml' }], steps: ['Koken.'] }];
    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [new File([JSON.stringify(recipes)], 'toetjes.json', { type: 'application/json' })] },
    });
    expect(await screen.findByText('staat al in de bibliotheek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Niets geselecteerd' })).toBeInTheDocument();
  });
});
