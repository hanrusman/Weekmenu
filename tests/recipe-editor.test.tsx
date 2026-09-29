import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { IngredientPreview, RecipeInput } from '../client/src/lib/api';

const previewIngredients = vi.fn();
vi.mock('../client/src/lib/api', () => ({ api: { previewIngredients: (...args: unknown[]) => previewIngredients(...args) } }));

const { default: RecipeEditor } = await import('../client/src/components/RecipeEditor');

const recipe: RecipeInput = {
  name: 'Curry', servings: 4, meal_type: null, prep_time_minutes: null, cost_index: null,
  ingredients: [
    { name: 'kokos melk', amount: 1, unit: 'blik', product_group: 'overig' },
    { name: 'pastinaak', amount: 2, unit: 'stuks', product_group: 'groenten' },
  ],
  steps: [], tip: null, nutrition_per_serving: null,
};

function preview(canonical: string, extra: Partial<IngredientPreview> = {}): IngredientPreview {
  return { canonical, ingredient_id: null, match: 'new', amount: 1, unit: 'stuks', adds_up: true, base_unit: null, suggestion: null, ...extra };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('RecipeEditor ingredient previews', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    previewIngredients.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('does not move a removed row\'s preview onto the next row', () => {
    previewIngredients.mockReturnValue(new Promise(() => {})); // refresh never arrives
    render(
      <RecipeEditor
        initial={recipe}
        initialPreview={[preview('kokos melk', { suggestion: 'kokosmelk' }), preview('pastinaak')]}
        actions={[{ label: 'Opslaan' }]}
        onSave={async () => {}}
      />,
    );
    expect(screen.getByText(/bedoel je kokosmelk/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('kokos melk verwijderen'));

    expect(screen.queryByText(/bedoel je/)).not.toBeInTheDocument();
    expect(screen.getByText(/nieuw: pastinaak/)).toBeInTheDocument();
  });

  it('hides a preview as soon as its row changes, until a fresh one arrives', () => {
    previewIngredients.mockReturnValue(new Promise(() => {}));
    render(
      <RecipeEditor
        initial={recipe}
        initialPreview={[preview('kokos melk', { suggestion: 'kokosmelk' }), preview('pastinaak')]}
        actions={[{ label: 'Opslaan' }]}
        onSave={async () => {}}
      />,
    );
    fireEvent.change(screen.getAllByLabelText('Ingrediënt')[0], { target: { value: 'kokosnoot' } });
    expect(screen.queryByText(/bedoel je kokosmelk/)).not.toBeInTheDocument();
  });

  it('ignores an older preview response that arrives after a newer one', async () => {
    const older = deferred<IngredientPreview[]>();
    const newer = deferred<IngredientPreview[]>();
    previewIngredients.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    render(<RecipeEditor initial={recipe} actions={[{ label: 'Opslaan' }]} onSave={async () => {}} />);

    act(() => { vi.advanceTimersByTime(400); }); // request for the initial rows
    fireEvent.change(screen.getAllByLabelText('Ingrediënt')[1], { target: { value: 'wortel' } });
    act(() => { vi.advanceTimersByTime(400); }); // request after the edit

    await act(async () => { newer.resolve([preview('kokos melk'), preview('wortel', { match: 'existing' })]); });
    await act(async () => { older.resolve([preview('kokos melk', { suggestion: 'kokosmelk' }), preview('pastinaak')]); });

    expect(screen.queryByText(/bedoel je kokosmelk/)).not.toBeInTheDocument();
    expect(screen.getByText(/nieuw: kokos melk/)).toBeInTheDocument();
  });
});
