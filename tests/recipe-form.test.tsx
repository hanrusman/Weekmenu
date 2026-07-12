import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RecipeForm from '../client/src/pages/RecipeForm';
import type { RecipeDraft } from '../client/src/lib/api';

const { mockCreateRecipe } = vi.hoisted(() => ({
  mockCreateRecipe: vi.fn(async () => ({ id: 1 })),
}));

vi.mock('../client/src/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../client/src/lib/api')>();
  return {
    ...original,
    api: { ...original.api, createRecipe: mockCreateRecipe },
  };
});

function renderForm(draft?: RecipeDraft) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/recepten/nieuw', state: draft ? { draft } : null }]}>
      <Routes>
        <Route path="/recepten/nieuw" element={<RecipeForm />} />
        <Route path="/recepten" element={<div>bibliotheek</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RecipeForm', () => {
  beforeEach(() => {
    mockCreateRecipe.mockClear();
  });

  it('renders an empty create form', () => {
    renderForm();
    expect(screen.getByText('Nieuw recept')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Pasta pesto met courgette')).toHaveValue('');
    expect(screen.getAllByLabelText('Ingrediënt')).toHaveLength(1);
  });

  it('adds and removes ingredient rows', () => {
    renderForm();
    fireEvent.click(screen.getByText('Ingrediënt', { selector: 'button' }));
    expect(screen.getAllByLabelText('Ingrediënt')).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText('Verwijder ingrediënt')[0]);
    expect(screen.getAllByLabelText('Ingrediënt')).toHaveLength(1);
  });

  it('prefills from an import draft and shows warnings', () => {
    renderForm({
      name: 'Nasi goreng',
      source: 'https://example.com/nasi',
      recipe_data: {
        servings: 2,
        ingredients: [{ name: 'rijst', amount: '300', unit: 'g', product_group: 'droogwaren' }],
        steps: ['Kook de rijst'],
        nutrition_per_serving: { calories: 500, protein_g: 22, fiber_g: 5, iron_mg: 3 },
      },
      tags: ['rijst'],
      warnings: ['Voedingswaarden niet gevonden — vul zelf aan'],
      method: 'jsonld',
    });

    expect(screen.getByPlaceholderText('Pasta pesto met courgette')).toHaveValue('Nasi goreng');
    expect(screen.getByLabelText('Ingrediënt')).toHaveValue('rijst');
    expect(screen.getByLabelText('Stap 1')).toHaveValue('Kook de rijst');
    expect(screen.getByText(/Voedingswaarden niet gevonden/)).toBeInTheDocument();
  });

  it('submits assembled RecipeData to createRecipe', async () => {
    renderForm();
    fireEvent.change(screen.getByPlaceholderText('Pasta pesto met courgette'), { target: { value: 'Testgerecht' } });
    fireEvent.change(screen.getByLabelText('Hoeveelheid'), { target: { value: '400' } });
    fireEvent.change(screen.getByLabelText('Eenheid'), { target: { value: 'g' } });
    fireEvent.change(screen.getByLabelText('Ingrediënt'), { target: { value: 'penne' } });
    fireEvent.change(screen.getByLabelText('Stap 1'), { target: { value: 'Kook de pasta' } });

    fireEvent.click(screen.getByText('Recept opslaan'));

    await waitFor(() => expect(mockCreateRecipe).toHaveBeenCalledTimes(1));
    const payload = mockCreateRecipe.mock.calls[0][0] as unknown as {
      name: string;
      recipe_data: { ingredients: unknown[]; steps: string[] };
    };
    expect(payload.name).toBe('Testgerecht');
    expect(payload.recipe_data.ingredients).toEqual([
      { name: 'penne', amount: '400', unit: 'g', product_group: 'overig' },
    ]);
    expect(payload.recipe_data.steps).toEqual(['Kook de pasta']);
  });

  it('blocks saving without a name', async () => {
    renderForm();
    fireEvent.click(screen.getByText('Recept opslaan'));
    expect(await screen.findByText('Naam is verplicht')).toBeInTheDocument();
    expect(mockCreateRecipe).not.toHaveBeenCalled();
  });
});
