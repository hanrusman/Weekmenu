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
    main_course: true, veg_exception: false, veg_per_serving: 0, veg_unweighed: [],
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

  it('says so for a recipe that is no dinner', () => {
    expect(chip({ main_course: false }).text).toBe('geen hoofdgerecht');
  });
});

describe('library filter', () => {
  it('shows only dinners below their norm', async () => {
    api.getRecipes.mockResolvedValue({
      recipes: [
        recipe(1, 'Pasta pesto', { veg_per_serving: 125 }),
        recipe(2, 'Groentecurry', { veg_per_serving: 400 }),
        recipe(3, 'Pizza', { veg_per_serving: 260, veg_exception: true }),
        recipe(4, 'Ringtaart', { main_course: false }),
      ],
      counts: { concept: 0, goedgekeurd: 4, archief: 0 },
    });
    render(<MemoryRouter initialEntries={['/recepten']}><RecipeLibrary /></MemoryRouter>);
    await screen.findByText('Pasta pesto');

    fireEvent.click(screen.getByLabelText(/Alleen te weinig groente/));
    expect(screen.getByText('Pasta pesto')).toBeInTheDocument();
    for (const name of ['Groentecurry', 'Pizza', 'Ringtaart']) expect(screen.queryByText(name)).not.toBeInTheDocument();
  });
});

describe('recipe editor labels', () => {
  const base: RecipeInput = {
    name: 'Ringtaart', servings: 8, meal_type: null, prep_time_minutes: null, cost_index: null,
    ingredients: [{ name: 'bloem', amount: 250, unit: 'g', product_group: 'droogwaren' }],
    steps: [], tip: null, nutrition_per_serving: null,
  };

  it('sends whether it is a main course and an exception', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const editor = () => render(<RecipeEditor initial={{ ...base, main_course: true }} initialPreview={[]} actions={[{ label: 'Opslaan' }]} onSave={onSave} />);

    const first = editor();
    fireEvent.click(screen.getByLabelText(/Uitzondering op de groentenorm/));
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ main_course: true, veg_exception: true }));
    first.unmount();

    // No dinner: no exception either, and the option is gone
    editor();
    fireEvent.click(screen.getByLabelText(/Uitzondering op de groentenorm/));
    fireEvent.click(screen.getByLabelText(/Hoofdgerecht/));
    expect(screen.queryByLabelText(/Uitzondering op de groentenorm/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ main_course: false, veg_exception: false }));
  });
});
