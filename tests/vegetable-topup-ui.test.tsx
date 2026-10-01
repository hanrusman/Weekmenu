import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { Recipe, VegetableJob, VegetableOverview } from '../client/src/lib/api';

const api = {
  getVegetables: vi.fn(),
  runVegetables: vi.fn(),
  getRecipe: vi.fn(),
  getRecipes: vi.fn(),
  revertVegetables: vi.fn(),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
}));

const { default: VegetableTopUp } = await import('../client/src/pages/VegetableTopUp');
const { default: LibraryRecipe } = await import('../client/src/pages/LibraryRecipe');

function job(fields: Partial<VegetableJob> = {}): VegetableJob {
  return {
    running: false, started_at: null, finished_at: null, total: 0, done: 0,
    counts: { boosted: 0, not_main: 0, enough: 0, failed: 0, stale: 0 }, current: [], error: null, ...fields,
  };
}

function overview(fields: Partial<VegetableOverview> = {}): VegetableOverview {
  return {
    configured: true, target: 350, minimum: 250,
    counts: { dinners: 190, below: 150, to_do: 150, not_main: 57 },
    job: job(), results: [], ...fields,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('vegetable top-up page', () => {
  const renderPage = () => render(<MemoryRouter><VegetableTopUp /></MemoryRouter>);

  it('shows where the library stands and starts a run for what is left', async () => {
    api.getVegetables.mockResolvedValueOnce(overview())
      .mockResolvedValue(overview({ job: job({ running: true, total: 150, done: 3, current: ['Pasta pesto'] }) }));
    api.runVegetables.mockResolvedValue({ job: job({ running: true, total: 150 }) });
    renderPage();

    expect(await screen.findByText(/van de 190 hoofdgerechten halen hun norm niet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Vul 150 recepten aan/ }));

    expect(api.runVegetables).toHaveBeenCalledWith(undefined);
    expect(await screen.findByText('3 van 150 verwerkt')).toBeInTheDocument();
    expect(screen.getByText(/nu: Pasta pesto/)).toBeInTheDocument();
  });

  it('lists outcomes and retries only the failed ones', async () => {
    api.getVegetables.mockResolvedValue(overview({
      counts: { dinners: 190, below: 2, to_do: 0, not_main: 57 },
      results: [
        { id: 1, name: 'Pasta garnalen', outcome: 'boosted', note: 'Meer courgette.', before: 100, after: 375, now: 375 },
        { id: 2, name: 'Kastanje carbonara', outcome: 'failed', note: 'niet gelukt: 300 g groente per persoon, onder de 350 g', before: null, after: null, now: 0 },
        { id: 3, name: 'Hazelnoottaart', outcome: 'not_main', note: 'geen hoofdgerecht', before: null, after: null, now: 0 },
        { id: 4, name: 'Stamppot', outcome: 'failed', note: 'niet gelukt: …', before: null, after: null, now: 80 },
        { id: 5, name: 'Linzensoep', outcome: 'stale', note: 'intussen bewerkt, niet aangepast; de volgende ronde probeert het opnieuw', before: null, after: null, now: 90 },
      ],
    }));
    api.runVegetables.mockResolvedValue({ job: job({ running: true, total: 2 }) });
    renderPage();

    expect(await screen.findByText('100 → 375 g', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Niet gelukt (2)')).toBeInTheDocument();
    expect(screen.getByText('Geen hoofdgerecht (1)')).toBeInTheDocument();
    expect(screen.getByText('Intussen bewerkt (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Niets meer aan te vullen' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(api.runVegetables).toHaveBeenCalledWith([2, 4]);
  });

  it('says so when the model is not set up', async () => {
    api.getVegetables.mockResolvedValue(overview({ configured: false }));
    renderPage();
    expect(await screen.findByText(/niet ingesteld/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vul 150 recepten aan/ })).toBeDisabled();
  });
});

describe('vegetable change on the recipe', () => {
  const recipe = (fields: Partial<Recipe> = {}): Recipe => ({
    id: 7, name: 'Pasta garnalen', source: 'import', recipe_data: '{"ingredients":[],"steps":[]}', tags: '[]',
    times_used: 0, last_used: null, created_at: '', status: 'concept', servings: 4, meal_type: 'pasta',
    prep_time_minutes: null, cost_index: null, rating_lekker: 0, rating_ok: 0, rating_minder: 0,
    image_version: null, image_requested_at: null, image_error: null,
    main_course: true, veg_exception: false, veg_per_serving: 375, veg_unweighed: [],
    veg_revision: { veg_before: 100, veg_after: 375, summary: 'Meer courgette en spinazie.', created_at: '2026-10-01' },
    ...fields,
  });

  it('shows what was added and puts it back after confirmation', async () => {
    api.getRecipe.mockResolvedValue(recipe());
    api.getRecipes.mockResolvedValue({ recipes: [recipe()], counts: { concept: 1, goedgekeurd: 0, archief: 0 } });
    api.revertVegetables.mockResolvedValue(recipe({ veg_per_serving: 100, veg_revision: null }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={['/recepten/7']}>
        <Routes><Route path="/recepten/:id" element={<LibraryRecipe />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/100 → 375 g per persoon/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Terugzetten' }));
    expect(confirm).toHaveBeenCalled();
    expect(api.revertVegetables).toHaveBeenCalledWith(7);
    await waitFor(() => expect(screen.queryByText(/Groente aangevuld/)).not.toBeInTheDocument());
    confirm.mockRestore();
  });
});
