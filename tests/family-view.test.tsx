import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import FamilyView from '../client/src/pages/FamilyView';
import { api, MenuDay } from '../client/src/lib/api';

function day(id: number, date: string, recipe_name: string, status = 'approved'): MenuDay {
  return {
    id, menu_id: 41, day_of_week: 0, day_name: 'Dag', date, recipe_name, recipe_data: '{}', meal_type: 'overig',
    prep_time_minutes: 30, cost_index: '€', status, completed_at: null, notes: null, week_number: 41,
  };
}

// Week 41 on Tuesday 13 October: Tuesday's orzo was eaten on Monday, Friday's curry is still open
const days = [
  day(84, '2026-10-08', 'Rijstbowl', 'completed'),
  day(85, '2026-10-09', 'Kokoscurry'),
  day(89, '2026-10-13', 'Aubergine orzo', 'completed'),
  day(90, '2026-10-14', 'Gebakken rijst'),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 13, 17, 0));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Week view', () => {
  it("shows tonight's dinner from the server, also when it was planned earlier in the week", async () => {
    vi.spyOn(api, 'getActiveMenu').mockResolvedValue({
      id: 41, week_number: 41, year: 2026, status: 'active', created_at: '', shopping_list: null,
      snack_suggestions: '[]', tonight_id: 85, days,
    });
    render(<MemoryRouter><FamilyView /></MemoryRouter>);

    const tonight = await screen.findByRole('region', { name: 'Vandaag' });
    expect(within(tonight).getByText('Kokoscurry')).toBeInTheDocument();
    expect(within(tonight).getByText('Op het menu voor vr 9 okt')).toBeInTheDocument();
    expect(within(tonight).getByText(/Vandaag · di 13 okt/)).toBeInTheDocument();

    // The eaten orzo is under "Gegeten", not tonight; nothing open is greyed out as "niet afgevinkt"
    expect(screen.getByRole('heading', { name: 'Gegeten' })).toBeInTheDocument();
    expect(screen.getByText('Aubergine orzo')).toBeInTheDocument();
    expect(screen.getByText('Gebakken rijst')).toBeInTheDocument();
    expect(screen.queryByText('niet afgevinkt')).not.toBeInTheDocument();
  });

  it("shows this week's breakfasts and snacks, each opening its recipe", async () => {
    vi.spyOn(api, 'getActiveMenu').mockResolvedValue({
      id: 41, week_number: 41, year: 2026, status: 'active', created_at: '', shopping_list: null,
      snack_suggestions: '["Mandarijn"]', tonight_id: 85, days,
      extras: [
        { id: 1, menu_id: 41, kind: 'ontbijt', day_name: 'Zaterdag', date: '2026-10-10', recipe_id: 313,
          recipe_name: 'PBJ overnight oats', meal_type: null, prep_time_minutes: 10, recipe_image_version: null },
        { id: 2, menu_id: 41, kind: 'snack', day_name: null, date: null, recipe_id: 479,
          recipe_name: 'Energy balls met dadel', meal_type: null, prep_time_minutes: null, recipe_image_version: null },
        // Next week's, shown with that week
        { id: 3, menu_id: 42, kind: 'ontbijt', day_name: null, date: null, recipe_id: 480,
          recipe_name: 'Ontbijtwaffels', meal_type: null, prep_time_minutes: 20, recipe_image_version: null },
      ],
    });
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<FamilyView />} />
          <Route path="/recepten/:id" element={<p>Recept geopend</p>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Ontbijt & tussendoortjes' })).toBeInTheDocument();
    expect(screen.getByText('Ontbijt · za 10 okt')).toBeInTheDocument();
    expect(screen.getByText('Tussendoortje')).toBeInTheDocument();
    expect(screen.queryByText('Ontbijtwaffels')).not.toBeInTheDocument();
    // Loose snack ideas from older menus give way to the planned snacks
    expect(screen.queryByText(/Mandarijn/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Energy balls met dadel'));
    expect(screen.getByText('Recept geopend')).toBeInTheDocument();
  });
});
