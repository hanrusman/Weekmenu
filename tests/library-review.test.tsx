import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
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
    image_version: null, image_requested_at: null, image_error: null,
    main_course: true, veg_exception: false, veg_per_serving: 0, veg_unweighed: [],
  };
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}{location.search}</div>;
}

/** Lets a test navigate elsewhere, as the user could while a request is still running. */
function GoTo() {
  const navigate = useNavigate();
  return <button onClick={() => navigate('/recepten/2')}>ga naar 2</button>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const statusButtons = () => screen.queryAllByRole('button', { name: /Goedkeuren|Archiveren/ });

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/recepten/:id" element={<><LibraryRecipe /><Where /><GoTo /></>} />
        <Route path="/recepten" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('reviewing recipes one after another', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  describe('while loading', () => {
    it('offers no status buttons until the list of recipes with that status is in', async () => {
      const list = deferred<{ recipes: Recipe[]; counts: object }>();
      api.getRecipes.mockReturnValueOnce(list.promise);
      renderAt('/recepten/1');
      await waitFor(() => expect(api.getRecipes).toHaveBeenCalled());
      expect(statusButtons()).toHaveLength(0);

      list.resolve({ recipes: [recipe(1), recipe(2)], counts: {} });
      expect(await screen.findAllByRole('button', { name: /Goedkeuren/ })).toHaveLength(2);
    });

    it('does not let the previous recipe be changed again after moving on', async () => {
      renderAt('/recepten/1');
      const next = deferred<Recipe>();
      fireEvent.click((await screen.findAllByRole('button', { name: /Goedkeuren/ }))[0]);
      api.getRecipe.mockReturnValueOnce(next.promise);

      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/recepten/2'));
      expect(statusButtons()).toHaveLength(0);
      expect(screen.queryByText('Linzensoep')).not.toBeInTheDocument();
      expect(api.setRecipeStatus).toHaveBeenCalledTimes(1);

      next.resolve(recipe(2));
      expect(await screen.findByRole('heading', { name: 'Erwtensoep' })).toBeInTheDocument();
    });

    it('ignores a late answer for a recipe it already left', async () => {
      const first = deferred<Recipe>();
      api.getRecipe.mockReturnValueOnce(first.promise);
      renderAt('/recepten/1');
      fireEvent.click(screen.getByRole('button', { name: 'ga naar 2' }));
      expect(await screen.findByRole('heading', { name: 'Erwtensoep' })).toBeInTheDocument();

      first.resolve(recipe(1));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.getByRole('heading', { name: 'Erwtensoep' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Linzensoep' })).not.toBeInTheDocument();
    });

    it('shows a failed status change next to the buttons at the top, not only at the bottom', async () => {
      api.setRecipeStatus.mockRejectedValueOnce(new Error('Server stuk'));
      renderAt('/recepten/1');
      fireEvent.click((await screen.findAllByRole('button', { name: /Goedkeuren/ }))[0]);

      const errors = await screen.findAllByText('Server stuk');
      expect(errors).toHaveLength(2);
      const heading = screen.getByRole('heading', { name: 'Linzensoep' });
      expect(errors[0].compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByTestId('where')).toHaveTextContent('/recepten/1');
    });
  });
});
