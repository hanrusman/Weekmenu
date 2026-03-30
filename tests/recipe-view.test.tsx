import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RecipeView from '../client/src/components/RecipeView';
import { RecipeData } from '../client/src/lib/api';

const mockRecipe: RecipeData = {
  ingredients: [
    { name: 'pasta', amount: '400', unit: 'g', product_group: 'droogwaren' },
    { name: 'courgette', amount: '2', unit: 'stuks', product_group: 'groenten' },
    { name: 'parmezaan', amount: '80', unit: 'g', product_group: 'zuivel' },
  ],
  steps: [
    'Kook de pasta al dente.',
    'Snijd de courgette in plakjes.',
    'Bak de courgette in olijfolie.',
  ],
  nutrition_per_serving: {
    calories: 450,
    protein_g: 22,
    fiber_g: 8,
    iron_mg: 3.1,
  },
  tip: 'Voeg een scheutje pasta-kookwater toe voor extra romigheid.',
};

describe('RecipeView', () => {
  it('should render recipe name', () => {
    render(
      <RecipeView
        recipe={mockRecipe}
        recipeName="Pasta met courgette"
        prepTime={20}
        costIndex="€"
      />,
    );
    expect(screen.getByText('Pasta met courgette')).toBeInTheDocument();
  });

  it('should render prep time and cost', () => {
    render(
      <RecipeView
        recipe={mockRecipe}
        recipeName="Test"
        prepTime={20}
        costIndex="€€"
      />,
    );
    expect(screen.getByText('20 min')).toBeInTheDocument();
    expect(screen.getByText('€€')).toBeInTheDocument();
  });

  it('should render nutrition info', () => {
    render(
      <RecipeView
        recipe={mockRecipe}
        recipeName="Test"
        prepTime={20}
        costIndex="€"
      />,
    );
    expect(screen.getByText('450 kcal')).toBeInTheDocument();
    expect(screen.getByText('8g vezels')).toBeInTheDocument();
    expect(screen.getByText('3.1mg ijzer')).toBeInTheDocument();
  });

  it('should render all ingredients', () => {
    render(
      <RecipeView
        recipe={mockRecipe}
        recipeName="Test"
        prepTime={20}
        costIndex="€"
      />,
    );
    expect(screen.getByText(/400 g pasta/)).toBeInTheDocument();
    expect(screen.getByText(/2 stuks courgette/)).toBeInTheDocument();
    expect(screen.getByText(/80 g parmezaan/)).toBeInTheDocument();
  });

  it('should render all steps', () => {
    render(
      <RecipeView
        recipe={mockRecipe}
        recipeName="Test"
        prepTime={20}
        costIndex="€"
      />,
    );
    expect(screen.getByText('Kook de pasta al dente.')).toBeInTheDocument();
    expect(screen.getByText('Snijd de courgette in plakjes.')).toBeInTheDocument();
    expect(screen.getByText('Bak de courgette in olijfolie.')).toBeInTheDocument();
  });

  it('should render tip when present', () => {
    render(
      <RecipeView
        recipe={mockRecipe}
        recipeName="Test"
        prepTime={20}
        costIndex="€"
      />,
    );
    expect(screen.getByText(/Voeg een scheutje pasta-kookwater/)).toBeInTheDocument();
  });

  it('should not render tip when absent', () => {
    const noTipRecipe = { ...mockRecipe, tip: undefined };
    render(
      <RecipeView
        recipe={noTipRecipe}
        recipeName="Test"
        prepTime={20}
        costIndex="€"
      />,
    );
    expect(screen.queryByText(/Tip:/)).not.toBeInTheDocument();
  });
});
