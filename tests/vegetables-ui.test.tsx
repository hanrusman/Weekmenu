import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Recipe, RecipeInput } from '../client/src/lib/api';

const api = {
  getRecipes: vi.fn(),
  previewIngredients: vi.fn().mockReturnValue(new Promise(() => {})),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
}));

const { default: VegetableChip } = await import('../client/src/components/VegetableChip');
const { default: RecipeLibrary } = await import('../client/src/pages/RecipeLibrary');
const { default: RecipeEditor } = await import('../client/src/components/RecipeEditor');

function recipe(id: number, name: string, fields: Partial<Recipe> = {}): Recipe {
  return {
    id, name, source: 'import', recipe_data: '{"ingredients":[],"steps":[]}', tags: '[]', times_used: 0, last_used: null,
    created_at: '', status: 'goedgekeurd', servings: 4, meal_type: 'pasta', prep_time_minutes: null, cost_index: null,
    rating_lekker: 0, rating_ok: 0, rating_minder: 0, image_version: null, image_requested_at: null, image_error: null,
    course: 'hoofdgerecht', main_course: true, veg_exception: false, veg_per_serving: 0, veg_unweighed: [],
    carbs_per_serving: 60, protein_per_serving: 25, meal_missing: [],
    ...fields,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('vegetable chip', () => {
  const chip = (fields: Partial<Recipe>) => {
    const { container, unmount } = render(<VegetableChip recipe={recipe(1, 'x', fields)} />);
    const result = { text: container.textContent, className: container.firstElementChild!.className };
    unmount();
    return result;
  };

  it('is green at the aim, amber above the minimum and red below it', () => {
    expect(chip({ veg_per_serving: 375 })).toMatchObject({ text: '🥦 375 g', className: expect.stringContaining('green') });
    expect(chip({ veg_per_serving: 300 }).className).toContain('amber');
    expect(chip({ veg_per_serving: 125 }).className).toContain('red');
  });

  it('holds an exception to the minimum, and marks lines it could not weigh', () => {
    expect(chip({ veg_per_serving: 260, veg_exception: true })).toMatchObject({
      text: '🥦 260 g · uitzondering', className: expect.stringContaining('green'),
    });
    expect(chip({ veg_per_serving: 200, veg_unweighed: ['1 krop sla of little gem'] }).text).toBe('🥦 200 g+');
  });

  it('says what kind of dish a recipe that is no dinner is, or that it is not known yet', () => {
    expect(chip({ course: 'toetje', main_course: false }).text).toBe('Toetje');
    expect(chip({ course: null, main_course: false }).text).toBe('soort onbekend');
  });
});

describe('library filter', () => {
  it('shows only dinners below their norm', async () => {
    api.getRecipes.mockResolvedValue({
      recipes: [
        recipe(1, 'Pasta pesto', { veg_per_serving: 125 }),
        recipe(2, 'Groentecurry', { veg_per_serving: 400 }),
        recipe(3, 'Pizza', { veg_per_serving: 260, veg_exception: true }),
        recipe(4, 'Ringtaart', { course: 'toetje', main_course: false }),
      ],
      counts: { concept: 0, goedgekeurd: 4, archief: 0 },
    });
    render(<MemoryRouter initialEntries={['/recepten']}><RecipeLibrary /></MemoryRouter>);
    await screen.findByText('Pasta pesto');

    fireEvent.click(screen.getByLabelText(/Alleen te weinig groente/));
    expect(screen.getByText('Pasta pesto')).toBeInTheDocument();
    for (const name of ['Groentecurry', 'Pizza', 'Ringtaart']) expect(screen.queryByText(name)).not.toBeInTheDocument();
  });

  it('filters on the kind of dish, and on dinners that are no whole meal', async () => {
    api.getRecipes.mockResolvedValue({
      recipes: [
        recipe(1, 'Groene salade', { veg_per_serving: 400, meal_missing: ['koolhydraten', 'eiwit'], carbs_per_serving: 0, protein_per_serving: 7 }),
        recipe(2, 'Groentecurry', { veg_per_serving: 400 }),
        recipe(3, 'Dadelballetjes', { course: 'snack', main_course: false }),
        recipe(4, 'Ringtaart', { course: null, main_course: false }),
      ],
      counts: { concept: 0, goedgekeurd: 4, archief: 0 },
    });
    render(<MemoryRouter initialEntries={['/recepten']}><RecipeLibrary /></MemoryRouter>);
    await screen.findByText('Groene salade');
    expect(screen.getByText('mist koolhydraten en eiwit')).toHaveAttribute('title', 'Geschat per persoon: 0 g koolhydraten, 7 g eiwit');

    fireEvent.click(screen.getByRole('button', { name: /^Snack/ }));
    expect(screen.getByText('Dadelballetjes')).toBeInTheDocument();
    for (const name of ['Groene salade', 'Groentecurry', 'Ringtaart']) expect(screen.queryByText(name)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Soort onbekend/ }));
    expect(screen.getByText('Ringtaart')).toBeInTheDocument();
    expect(screen.queryByText('Dadelballetjes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Alle soorten/ }));
    fireEvent.click(screen.getByLabelText(/Alleen geen hele maaltijd/));
    expect(screen.getByText('Groene salade')).toBeInTheDocument();
    for (const name of ['Groentecurry', 'Dadelballetjes', 'Ringtaart']) expect(screen.queryByText(name)).not.toBeInTheDocument();
  });
});

describe('recipe editor labels', () => {
  const base: RecipeInput = {
    name: 'Ringtaart', servings: 8, meal_type: null, prep_time_minutes: null, cost_index: null,
    ingredients: [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }],
    steps: [], tip: null, nutrition_per_serving: null,
  };

  const editor = (initial: RecipeInput, onSave: (input: RecipeInput) => Promise<void>) =>
    render(<RecipeEditor initial={initial} initialPreview={[]} actions={[{ label: 'Opslaan' }]} onSave={onSave} />);

  it('sends the kind of dish and whether it is an exception', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);

    // A new recipe starts as hoofdgerecht
    const first = editor(base, onSave);
    expect(screen.getByLabelText('Soort gerecht')).toHaveValue('hoofdgerecht');
    fireEvent.click(screen.getByLabelText(/Uitzondering op de groentenorm/));
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ course: 'hoofdgerecht', veg_exception: true }));
    first.unmount();

    // No dinner: no exception either, and the option is gone
    editor({ ...base, course: 'hoofdgerecht' }, onSave);
    fireEvent.click(screen.getByLabelText(/Uitzondering op de groentenorm/));
    fireEvent.change(screen.getByLabelText('Soort gerecht'), { target: { value: 'toetje' } });
    expect(screen.queryByLabelText(/Uitzondering op de groentenorm/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ course: 'toetje', veg_exception: false }));
  });

  it('leaves a kind that is not known yet to the bulk run, unless one is chosen', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const first = editor({ ...base, course: null }, onSave);
    expect(screen.getByLabelText('Soort gerecht')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'nog onbekend' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onSave.mock.lastCall![0].course).toBeUndefined();
    first.unmount();

    editor({ ...base, course: null }, onSave);
    fireEvent.change(screen.getByLabelText('Soort gerecht'), { target: { value: 'snack' } });
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ course: 'snack' }));
  });
});
