import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = {
  getParserStatus: vi.fn(),
  getRecipes: vi.fn(),
  createRecipe: vi.fn(),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
}));

const { default: RecipeBulkImport } = await import('../client/src/pages/RecipeBulkImport');

const recipe = (name: string) => ({ name, ingredients: [{ name: 'ui', amount: 1, unit: 'stuks' }], steps: ['Koken.'] });

async function loadFile() {
  render(<MemoryRouter><RecipeBulkImport /></MemoryRouter>);
  const file = new File([JSON.stringify([recipe('Linzensoep'), recipe('Erwtensoep'), recipe('Stamppot')])],
    'recepten.json', { type: 'application/json' });
  fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [file] } });
  await screen.findByText('Linzensoep');
}

const importButton = () => screen.getByRole('button', { name: /Importeer|Niets geselecteerd/ });

beforeEach(() => {
  vi.clearAllMocks();
  api.getParserStatus.mockResolvedValue({ configured: true });
  api.getRecipes.mockResolvedValue({ recipes: [], counts: { concept: 0, goedgekeurd: 0, archief: 0 } });
});

describe('selecting in the bulk import', () => {
  it('starts with every new recipe selected', async () => {
    await loadFile();
    expect(importButton()).toHaveTextContent('Importeer 3 recepten als concept');
  });

  it('"Niets" right after "Alles" clears everything, even before the page redraws', async () => {
    await loadFile();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Alles' }));
      fireEvent.click(screen.getByRole('button', { name: 'Niets' }));
    });
    expect(importButton()).toHaveTextContent('Niets geselecteerd');
  });

  it('selects and clears only what the search shows', async () => {
    await loadFile();
    fireEvent.change(screen.getByPlaceholderText('Zoek in de gevonden recepten...'), { target: { value: 'soep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Niets' }));
    expect(importButton()).toHaveTextContent('Importeer 1 recept als concept'); // Stamppot, hidden by the search

    fireEvent.click(screen.getByRole('button', { name: 'Alles' }));
    expect(importButton()).toHaveTextContent('Importeer 3 recepten als concept');
  });
});
