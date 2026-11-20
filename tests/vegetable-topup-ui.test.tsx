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
  trimVegetables: vi.fn(),
  revertTrim: vi.fn(),
  trimAllVegetables: vi.fn(),
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
    configured: true, target: 250, minimum: 175,
    counts: { dinners: 190, below: 150, incomplete: 40, unknown: 12, to_do: 160, not_main: 45 },
    job: job(), results: [], ...fields,
  };
}

const noTrim = { counts: { trimmed: 0, fine: 0, original: 0, done: 0, meal: 0, not_dinner: 0 }, trimmed: [] };

beforeEach(() => {
  vi.clearAllMocks();
  // Nothing to bring back, unless a test says so
  api.trimAllVegetables.mockResolvedValue(noTrim);
});

describe('vegetable top-up page', () => {
  const renderPage = () => render(<MemoryRouter><VegetableTopUp /></MemoryRouter>);

  it('shows where the library stands and starts a run for what is left', async () => {
    api.getVegetables.mockResolvedValueOnce(overview())
      .mockResolvedValue(overview({ job: job({ running: true, total: 150, done: 3, current: ['Pasta pesto'] }) }));
    api.runVegetables.mockResolvedValue({ job: job({ running: true, total: 150 }) });
    renderPage();

    expect(await screen.findByText(/van de 190 hoofdgerechten halen hun norm niet/)).toBeInTheDocument();
    expect(screen.getByText(/zijn geen hele maaltijd/)).toHaveTextContent('40 zijn geen hele maaltijd (te weinig koolhydraten of eiwit).');
    expect(screen.getByText(/nog niet geprobeerd/)).toHaveTextContent('160 nog niet geprobeerd · 12 soort nog onbekend · 45 ander soort gerecht');
    fireEvent.click(screen.getByRole('button', { name: /Vul 160 recepten aan/ }));

    expect(api.runVegetables).toHaveBeenCalledWith(undefined);
    expect(await screen.findByText('3 van 150 verwerkt')).toBeInTheDocument();
    expect(screen.getByText(/nu: Pasta pesto/)).toBeInTheDocument();
  });

  it('lists outcomes and retries only the failed ones', async () => {
    api.getVegetables.mockResolvedValue(overview({
      counts: { dinners: 190, below: 2, incomplete: 0, unknown: 0, to_do: 0, not_main: 57 },
      results: [
        { id: 1, name: 'Pasta garnalen', outcome: 'boosted', note: 'Meer courgette.', before: 100, after: 375, now: 375 },
        { id: 2, name: 'Kastanje carbonara', outcome: 'failed', note: 'niet gelukt: 300 g groente per persoon, onder de 350 g', before: null, after: null, now: 0 },
        { id: 3, name: 'Hazelnoottaart', outcome: 'not_main', note: 'toetje volgens het model', before: null, after: null, now: 0 },
        { id: 6, name: 'Kip uit de oven', outcome: 'boosted', note: 'Krieltjes erbij.', before: 350, after: 350, now: 350 },
        { id: 7, name: 'Zalm met sperziebonen', outcome: 'boosted', note: 'Courgette erbij.', before: 167, after: 467, now: 253 },
        { id: 4, name: 'Stamppot', outcome: 'failed', note: 'niet gelukt: …', before: null, after: null, now: 80 },
        { id: 5, name: 'Linzensoep', outcome: 'stale', note: 'intussen bewerkt, niet aangepast; de volgende ronde probeert het opnieuw', before: null, after: null, now: 90 },
      ],
    }));
    api.runVegetables.mockResolvedValue({ job: job({ running: true, total: 2 }) });
    renderPage();

    expect(await screen.findByText('100 → 375 g', { exact: false })).toBeInTheDocument();
    // Brought back since its top-up: what it holds now is said too, and only then
    expect(screen.getByText('Zalm met sperziebonen').parentElement).toHaveTextContent('167 → 467 g · nu 253 g');
    expect(screen.getByText('Pasta garnalen').parentElement).not.toHaveTextContent('nu');
    expect(screen.getByText('Niet gelukt (2)')).toBeInTheDocument();
    expect(screen.getByText('Ander soort gerecht (1)')).toBeInTheDocument();
    expect(screen.getByText('toetje volgens het model')).toBeInTheDocument();
    // Only carbohydrate added: no vegetable change to show
    expect(screen.getByText('Krieltjes erbij.').parentElement).not.toHaveTextContent('→');
    expect(screen.getByText('Intussen bewerkt (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Niets meer aan te vullen' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(api.runVegetables).toHaveBeenCalledWith([2, 4]);
  });

  // Han: the top-ups are what makes a portion too big; the recipe as written is left alone
  it('offers to bring back the top-ups that made the portion too big, and says what came of it', async () => {
    const report = { counts: { trimmed: 260, fine: 392, original: 74, done: 0, meal: 0, not_dinner: 0 }, trimmed: [] };
    api.getVegetables.mockResolvedValue(overview({ counts: { dinners: 726, below: 0, incomplete: 0, unknown: 0, to_do: 0, not_main: 57 } }));
    api.trimAllVegetables.mockResolvedValue(report);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();

    // How many is worked out on the server, without changing anything
    expect(await screen.findByText(/heeft het aanvullen de portie te groot gemaakt/)).toHaveTextContent('Bij 260 recepten');
    expect(api.trimAllVegetables).toHaveBeenCalledWith(true);
    expect(screen.getByText(/Wat het recept zelf aan groente had blijft/)).toHaveTextContent('pasta naar 250 g');
    fireEvent.click(screen.getByRole('button', { name: 'Stel aanvullingen bij' }));

    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('260 aanvullingen bijgesteld.');
    expect(api.trimAllVegetables.mock.calls).toEqual([[true], []]);
    expect(screen.queryByRole('button', { name: 'Stel aanvullingen bij' })).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it('does not change anything without a yes', async () => {
    api.getVegetables.mockResolvedValue(overview());
    api.trimAllVegetables.mockResolvedValue({ counts: { trimmed: 3, fine: 0, original: 0, done: 0, meal: 0, not_dinner: 0 }, trimmed: [] });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Stel aanvullingen bij' }));
    expect(api.trimAllVegetables.mock.calls).toEqual([[true]]);
    confirm.mockRestore();
  });

  it('makes no offer when every top-up fits', async () => {
    api.getVegetables.mockResolvedValue(overview());
    renderPage();
    expect(await screen.findByText(/van de 190 hoofdgerechten halen hun norm niet/)).toBeInTheDocument();
    await waitFor(() => expect(api.trimAllVegetables).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('button', { name: 'Stel aanvullingen bij' })).not.toBeInTheDocument();
  });

  it('says so when the model is not set up', async () => {
    api.getVegetables.mockResolvedValue(overview({ configured: false }));
    renderPage();
    expect(await screen.findByText(/niet ingesteld/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vul 160 recepten aan/ })).toBeDisabled();
  });
});

describe('vegetable change on the recipe', () => {
  const recipe = (fields: Partial<Recipe> = {}): Recipe => ({
    id: 7, name: 'Pasta garnalen', source: 'import', recipe_data: '{"ingredients":[],"steps":[]}', tags: '[]',
    times_used: 0, last_used: null, created_at: '', status: 'concept', servings: 4, meal_type: 'pasta',
    prep_time_minutes: null, cost_index: null, rating_count: 0, rating_avg: null,
    image_version: null, image_requested_at: null, image_error: null,
    course: 'hoofdgerecht', main_course: true, veg_exception: false, veg_per_serving: 375, veg_unweighed: [],
    carbs_per_serving: 60, protein_per_serving: 25, meal_missing: [],
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

  const page = () => render(
    <MemoryRouter initialEntries={['/recepten/7']}>
      <Routes><Route path="/recepten/:id" element={<LibraryRecipe />} /></Routes>
    </MemoryRouter>,
  );

  it('offers to bring back a top-up that made the portion too big', async () => {
    const big = recipe({ veg_per_serving: 600, veg_trimmable: true });
    api.getRecipe.mockResolvedValue(big);
    api.getRecipes.mockResolvedValue({ recipes: [big], counts: { concept: 1, goedgekeurd: 0, archief: 0 } });
    api.trimVegetables.mockResolvedValue({
      outcome: 'trimmed',
      recipe: recipe({ veg_per_serving: 330, veg_trimmable: false,
        veg_trim: { veg_before: 600, veg_after: 330, summary: 'Minder komkommer en cherrytomaat.', created_at: '2026-11-20' } }),
    });
    page();

    expect(await screen.findByText(/Het aanvullen heeft de portie groot gemaakt/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stel de aanvulling bij' }));
    expect((await screen.findByText(/Aanvulling bijgesteld/)).parentElement).toHaveTextContent(
      'Aanvulling bijgesteld: 600 → 330 g groente per persoon. Minder komkommer en cherrytomaat.');
    expect(api.trimVegetables).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('button', { name: 'Stel de aanvulling bij' })).not.toBeInTheDocument();
  });

  it('says only what changed when the vegetables stayed, and puts it back after confirmation', async () => {
    const trimmed = recipe({ veg_per_serving: 375,
      veg_trim: { veg_before: 375, veg_after: 375, summary: 'Volkoren spaghetti van 400 naar 250 g.', created_at: '2026-11-20' } });
    api.getRecipe.mockResolvedValue(trimmed);
    api.getRecipes.mockResolvedValue({ recipes: [trimmed], counts: { concept: 1, goedgekeurd: 0, archief: 0 } });
    api.revertTrim.mockResolvedValue(recipe({ veg_per_serving: 375, veg_trim: null }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    page();

    expect((await screen.findByText(/Aanvulling bijgesteld/)).parentElement).toHaveTextContent('Aanvulling bijgesteld: Volkoren spaghetti van 400 naar 250 g. Terugzetten');
    // Two ways back on the page: the top-up itself, and what was brought back of it
    fireEvent.click(screen.getAllByRole('button', { name: 'Terugzetten' })[1]);
    expect(confirm).toHaveBeenCalled();
    expect(api.revertTrim).toHaveBeenCalledWith(7);
    await waitFor(() => expect(screen.queryByText(/Aanvulling bijgesteld/)).not.toBeInTheDocument());
    confirm.mockRestore();
  });

  it('says why nothing changed, and makes no offer for a top-up that fits', async () => {
    const big = recipe({ veg_trimmable: true });
    api.getRecipe.mockResolvedValue(big);
    api.getRecipes.mockResolvedValue({ recipes: [big], counts: { concept: 1, goedgekeurd: 0, archief: 0 } });
    // Edited meanwhile, so nothing is too much anymore
    api.trimVegetables.mockResolvedValue({ outcome: 'fine', recipe: recipe({ veg_trimmable: false }) });
    page();

    fireEvent.click(await screen.findByRole('button', { name: 'Stel de aanvulling bij' }));
    // (the page shows a message above and below the recipe)
    expect((await screen.findAllByText(/De aanvulling past bij dit gerecht/)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Stel de aanvulling bij' })).not.toBeInTheDocument();
  });
});
