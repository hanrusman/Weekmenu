import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { Recipe, RecipeStatus } from '../client/src/lib/api';

const api = {
  getRecipe: vi.fn(),
  getRecipes: vi.fn(),
  setRecipeStatus: vi.fn(),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
}));

const { default: LibraryRecipe } = await import('../client/src/pages/LibraryRecipe');

// A small library: three concepts in list order, and their statuses as the server knows them
let statuses: Record<number, RecipeStatus>;
const names: Record<number, string> = { 1: 'Linzensoep', 2: 'Erwtensoep', 3: 'Stamppot' };

function recipe(id: number): Recipe {
  return {
    id, name: names[id], source: 'import', recipe_data: JSON.stringify({ ingredients: [], steps: [] }), tags: '[]',
    times_used: 0, last_used: null, created_at: '', status: statuses[id], servings: 4, meal_type: null,
    prep_time_minutes: null, cost_index: null, rating_lekker: 0, rating_ok: 0, rating_minder: 0,
  };
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}{location.search}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/recepten/:id" element={<><LibraryRecipe /><Where /></>} />
        <Route path="/recepten" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('reviewing recipes one after another', () => {
  beforeEach(() => {
    statuses = { 1: 'concept', 2: 'concept', 3: 'concept' };
    window.scrollTo = vi.fn();
    api.getRecipe.mockImplementation(async (id: number) => recipe(id));
    api.getRecipes.mockImplementation(async ({ status }: { status: RecipeStatus }) => ({
      recipes: [1, 2, 3].filter((id) => statuses[id] === status).map(recipe),
      counts: {},
    }));
    api.setRecipeStatus.mockImplementation(async (id: number, status: RecipeStatus) => {
      statuses[id] = status;
      return recipe(id);
    });
  });

  it('shows the position among recipes with the same status', async () => {
    renderAt('/recepten/2');
    expect(await screen.findByText(/2 van 3/)).toBeInTheDocument();
  });

  it('moves on to the next concept after approving, with a way to undo', async () => {
    renderAt('/recepten/1');
    fireEvent.click((await screen.findAllByRole('button', { name: /Goedkeuren/ }))[0]);

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recepten/2'));
    expect(api.setRecipeStatus).toHaveBeenCalledWith(1, 'goedgekeurd');
    expect(await screen.findByRole('status')).toHaveTextContent('Linzensoep goedgekeurd');
    expect(await screen.findByText(/1 van 2/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ongedaan maken' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recepten/1'));
    expect(api.setRecipeStatus).toHaveBeenLastCalledWith(1, 'concept');
  });

  it('after the last one in the list, continues from the top', async () => {
    renderAt('/recepten/3');
    fireEvent.click((await screen.findAllByRole('button', { name: /Archiveren/ }))[0]);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recepten/1'));
    expect(await screen.findByRole('status')).toHaveTextContent('Stamppot gearchiveerd');
  });

  it('goes back to the list when nothing with that status is left', async () => {
    statuses = { 1: 'concept', 2: 'goedgekeurd', 3: 'goedgekeurd' };
    renderAt('/recepten/1');
    fireEvent.click((await screen.findAllByRole('button', { name: /Goedkeuren/ }))[0]);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recepten?status=concept'));
  });
});
