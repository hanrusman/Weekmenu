import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { MenuDay, Recipe } from '../client/src/lib/api';

const api = {
  getRecipe: vi.fn(),
  getRecipes: vi.fn(),
  setRecipeStatus: vi.fn(),
  requestRecipeImage: vi.fn(),
};
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
}));

const { default: MealImage } = await import('../client/src/components/MealImage');
const { default: DayCard } = await import('../client/src/components/DayCard');
const { default: LibraryRecipe } = await import('../client/src/pages/LibraryRecipe');
const { default: RecipeLibrary } = await import('../client/src/pages/RecipeLibrary');

function recipe(fields: Partial<Recipe> = {}): Recipe {
  return {
    id: 7, name: 'Kabeljauw met groente uit de oven', source: 'import',
    recipe_data: JSON.stringify({ ingredients: [], steps: [] }), tags: '[]', times_used: 0, last_used: null,
    created_at: '', status: 'concept', servings: 4, meal_type: 'oven', prep_time_minutes: null, cost_index: null,
    rating_lekker: 0, rating_ok: 0, rating_minder: 0,
    image_version: null, image_requested_at: null, image_error: null,
    main_course: true, veg_exception: false, veg_per_serving: 0, veg_unweighed: [],
    ...fields,
  };
}

const sources = () => Array.from(document.querySelectorAll('img')).map((img) => img.getAttribute('src'));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MealImage', () => {
  it('shows the recipe\'s own picture first', () => {
    render(<MealImage ownSrc="/api/recipes/7/image?v=2" recipeName="Nasi goreng" mealType="rijst" size={64} />);
    expect(sources()).toEqual(['/api/recipes/7/image?v=2']);
  });

  it('falls back to the matching illustration when the own picture fails to load', () => {
    render(<MealImage ownSrc="/api/recipes/7/image?v=2" recipeName="Nasi goreng" mealType="rijst" size={64} />);
    fireEvent.error(document.querySelector('img')!);
    expect(sources()).toEqual(['/icons/meals/nasi-goreng.png']);
  });

  it('ends at the fallback when nothing loads or nothing matches', () => {
    const { unmount } = render(
      <MealImage recipeName="Nasi goreng" mealType="rijst" size={64} fallback={<span>🍚</span>} />,
    );
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText('🍚')).toBeInTheDocument();
    unmount();

    render(<MealImage recipeName="Iets heel onbekends" mealType="" size={64} fallback={<span>🍽️</span>} />);
    expect(sources()).toEqual([]);
    expect(screen.getByText('🍽️')).toBeInTheDocument();
  });
});

describe('week menu', () => {
  const day: MenuDay = {
    id: 1, menu_id: 1, day_of_week: 0, day_name: 'Maandag', date: null, recipe_name: 'Kabeljauw met groente uit de oven',
    recipe_data: '{}', meal_type: 'oven', prep_time_minutes: 30, cost_index: '€', status: 'approved',
    completed_at: null, notes: null, recipe_id: 7, recipe_image_version: 3,
  };

  it('shows the library recipe\'s own picture on the day', () => {
    render(<DayCard day={day} />);
    expect(sources()).toEqual(['/api/recipes/7/image?v=3']);
  });

  it('without one, keeps the emoji for a day that matches no illustration', () => {
    render(<DayCard day={{ ...day, recipe_id: null, recipe_image_version: null }} />);
    expect(sources()).toEqual([]);
    expect(screen.getByText('🫕')).toBeInTheDocument();
  });
});

describe('library list', () => {
  it('shows each recipe\'s own picture', async () => {
    api.getRecipes.mockResolvedValue({
      recipes: [recipe({ image_version: 2 })],
      counts: { concept: 1, goedgekeurd: 0, archief: 0 },
    });
    render(<MemoryRouter initialEntries={['/recepten']}><RecipeLibrary /></MemoryRouter>);
    await screen.findByText('Kabeljauw met groente uit de oven');
    expect(sources()).toEqual(['/api/recipes/7/image?v=2']);
  });
});

describe('picture status on the review page', () => {
  function renderRecipe(r: Recipe) {
    api.getRecipe.mockResolvedValue(r);
    api.getRecipes.mockResolvedValue({ recipes: [r], counts: { concept: 1, goedgekeurd: 0, archief: 0 } });
    render(
      <MemoryRouter initialEntries={[`/recepten/${r.id}`]}>
        <Routes><Route path="/recepten/:id" element={<LibraryRecipe />} /></Routes>
      </MemoryRouter>,
    );
  }

  it('says a recipe without picture is waiting for one', async () => {
    renderRecipe(recipe());
    expect(await screen.findByText('In de wachtrij voor een plaatje')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /plaatje/i })).not.toBeInTheDocument();
  });

  it('shows the own picture and asks for a new one', async () => {
    renderRecipe(recipe({ image_version: 2 }));
    await screen.findByText('Kabeljauw met groente uit de oven');
    expect(sources()).toContain('/api/recipes/7/image?v=2');

    api.requestRecipeImage.mockResolvedValue(recipe({ image_version: 2, image_requested_at: '2026-09-30T10:00:00.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Nieuw plaatje' }));
    expect(await screen.findByText('In de wachtrij voor een nieuw plaatje')).toBeInTheDocument();
    expect(api.requestRecipeImage).toHaveBeenCalledWith(7);
  });

  it('shows why the last attempt failed, with a way to try again', async () => {
    renderRecipe(recipe({ image_error: 'Geen transparante achtergrond' }));
    expect(await screen.findByText(/Plaatje maken mislukt: Geen transparante achtergrond/)).toBeInTheDocument();

    api.requestRecipeImage.mockResolvedValue(recipe({ image_requested_at: '2026-09-30T10:00:00.000Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen' }));
    expect(await screen.findByText('In de wachtrij voor een plaatje')).toBeInTheDocument();
  });

  it('offers to make one for an archived recipe, which is not queued by itself', async () => {
    renderRecipe(recipe({ status: 'archief' }));
    expect(await screen.findByRole('button', { name: 'Plaatje maken' })).toBeInTheDocument();
  });

  it('shows a failed request as an error', async () => {
    renderRecipe(recipe({ image_version: 1 }));
    api.requestRecipeImage.mockRejectedValue(new Error('Recept niet gevonden'));
    fireEvent.click(await screen.findByRole('button', { name: 'Nieuw plaatje' }));
    await waitFor(() => expect(screen.getAllByText('Recept niet gevonden').length).toBeGreaterThan(0));
  });
});
