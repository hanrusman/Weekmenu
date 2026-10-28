import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { PlannerRecipe } from '../shared/menu-rules';
import type { PlannerState, ProposalJob } from '../shared/menu-planner';

const api = { importMenu: vi.fn() };
const plannerApi = { get: vi.fn(), propose: vi.fn(), proposal: vi.fn() };
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
  plannerApi,
}));

const { default: MenuPicker } = await import('../client/src/pages/MenuPicker');

function dinner(id: number, name: string, fields: Partial<PlannerRecipe> = {}): PlannerRecipe {
  return {
    id, name, status: 'goedgekeurd', meal_type: 'rijst', prep_time_minutes: 25, cost_index: '€', protein: [],
    veg_per_serving: 360, veg_exception: false, meal_missing: [], rating_avg: null, rating_count: 0, recent_weeks: [],
    last_used: null, recipe_image_version: null, ingredients: [], ...fields,
  };
}

const recipes = [
  dinner(1, 'Zalm uit de oven', { protein: ['vis'], meal_type: 'oven' }),
  dinner(2, 'Linzensoep', { protein: ['peulvruchten'], meal_type: 'soep' }),
  dinner(3, 'Gehaktballen', { protein: ['vlees'], meal_type: 'stamppot', prep_time_minutes: 45 }),
  dinner(4, 'Pasta pesto', { meal_type: 'pasta', veg_per_serving: 200, meal_missing: ['eiwit'] }),
];

const DAYS = ['Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag', 'Maandag', 'Dinsdag', 'Woensdag'];

function job(fields: Partial<ProposalJob> = {}): ProposalJob {
  return {
    running: false, started_at: null, finished_at: null, week_number: null, year: null,
    attempt: 0, attempts: 3, model: null, proposal: null, error: null, ...fields,
  };
}

function state(fields: Partial<PlannerState> = {}): PlannerState {
  return {
    configured: true, week_number: 45, year: 2026,
    previous: { week_number: 44, year: 2026 }, next: { week_number: 46, year: 2026 },
    days: DAYS.map((day_name, i) => ({ day_name, date: `2026-11-${String(5 + i).padStart(2, '0')}` })),
    existing: null, recipes,
    breakfasts: [{ id: 31, name: 'Overnight oats', status: 'goedgekeurd', prep_time_minutes: 5, recipe_image_version: null }],
    snacks: [], per_week: { breakfasts: 2, snacks: 2 }, job: job(), ...fields,
  };
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/plannen/kiezen']}>
    <Routes><Route path="/plannen/kiezen" element={<MenuPicker />} /></Routes>
  </MemoryRouter>,
);

/** The row of a day, by its short name ("do" for Donderdag). */
const dayRow = (name: string) => screen.getByText(name.slice(0, 2).toLowerCase(), { selector: 'span' }).closest('li')!;
const weekCheck = (label: string) => within(screen.getByRole('region', { name: 'Kaders deze week' }))
  .getByText(label).closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('menu picker', () => {
  it('picks a dinner per day and shows how the week keeps to the rules', async () => {
    plannerApi.get.mockResolvedValue(state());
    renderPage();

    expect(await screen.findByText('Week 45')).toBeInTheDocument();
    expect(weekCheck('Vis')).toHaveTextContent('0× (minstens 2)');
    expect(weekCheck('Dagen')).toHaveTextContent('0 van 7 gekozen');

    fireEvent.click(within(dayRow('Donderdag')).getByRole('button', { name: /Kies een recept/ }));
    // The fish counts towards the week's fish; the pesto pasta is off on its own
    const chooser = within(dayRow('Donderdag'));
    expect(chooser.getByRole('button', { name: /Zalm uit de oven/ })).toHaveTextContent('Past · telt mee voor vis');
    expect(chooser.getByRole('button', { name: /Pasta pesto/ })).toHaveTextContent('200 g groente (doel 350 g) · mist eiwit');
    fireEvent.click(chooser.getByRole('button', { name: /Zalm uit de oven/ }));

    expect(weekCheck('Vis')).toHaveTextContent('1× (minstens 2)');
    expect(weekCheck('Dagen')).toHaveTextContent('1 van 7 gekozen');

    // A slow dinner on a weekday is flagged on that day
    fireEvent.click(within(dayRow('Vrijdag')).getByRole('button', { name: /Kies een recept/ }));
    fireEvent.click(within(dayRow('Vrijdag')).getByRole('button', { name: /Gehaktballen/ }));
    expect(within(dayRow('Vrijdag')).getByText('45 min op een doordeweekse dag')).toBeInTheDocument();
  });

  it('asks the model for the open days, keeping what was chosen', async () => {
    plannerApi.get.mockResolvedValue(state());
    plannerApi.propose.mockResolvedValue({ job: job({ running: true, attempt: 1, model: 'cloud-glm', week_number: 45, year: 2026 }) });
    renderPage();
    await screen.findByText('Week 45');

    fireEvent.click(within(dayRow('Donderdag')).getByRole('button', { name: /Kies een recept/ }));
    fireEvent.click(within(dayRow('Donderdag')).getByRole('button', { name: /Linzensoep/ }));
    fireEvent.change(screen.getByLabelText('Wensen voor deze week'), { target: { value: 'iets met pompoen' } });
    fireEvent.click(screen.getByRole('button', { name: /Vul 6 open dagen/ }));

    await waitFor(() => expect(plannerApi.propose).toHaveBeenCalled());
    const body = plannerApi.propose.mock.calls[0][0];
    expect(body).toMatchObject({ week_number: 45, year: 2026, wishes: 'iets met pompoen', breakfasts: [], snacks: [] });
    expect(body.days[0]).toEqual({ day_name: 'Donderdag', recipe_id: 2, free: false });
    expect(body.days[1]).toEqual({ day_name: 'Vrijdag', recipe_id: null, free: false });
    expect(await screen.findByText(/Poging 1 van 3 · cloud-glm/)).toBeInTheDocument();
  });

  it('fills the open days with a finished proposal for this week, once', async () => {
    const proposal = {
      days: DAYS.map((day_name, i) => ({ day_name, date: null, recipe_id: i === 0 ? 1 : i === 1 ? 2 : null })),
      breakfasts: [31], snacks: [], note: 'Vis en peulvruchten.', model: 'cloud-glm', fails: [], warnings: [],
    };
    plannerApi.get.mockResolvedValue(state({
      job: job({ week_number: 45, year: 2026, started_at: '2026-10-28T10:00:00Z', proposal, model: 'cloud-glm' }),
    }));
    renderPage();

    expect(await screen.findByText('Vis en peulvruchten.')).toBeInTheDocument();
    expect(within(dayRow('Donderdag')).getByText('Zalm uit de oven')).toBeInTheDocument();
    expect(within(dayRow('Vrijdag')).getByText('Linzensoep')).toBeInTheDocument();
    expect(screen.getByLabelText('Ontbijt 1')).toHaveValue('31');

    // Emptying a day afterwards does not bring the proposal back
    fireEvent.click(screen.getByRole('button', { name: 'Maak donderdag leeg' }));
    expect(within(dayRow('Donderdag')).getByText('Kies een recept')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('weekmenu:kiezen:2026-45')!).applied).toBe('2026-10-28T10:00:00Z');
  });

  it('puts the chosen days on the menu, a free day left out', async () => {
    plannerApi.get.mockResolvedValue(state());
    api.importMenu.mockResolvedValue({});
    renderPage();
    await screen.findByText('Week 45');

    fireEvent.click(within(dayRow('Donderdag')).getByRole('button', { name: /Kies een recept/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Geen avondeten plannen (vrij)' }));
    fireEvent.click(within(dayRow('Vrijdag')).getByRole('button', { name: /Kies een recept/ }));
    fireEvent.click(within(dayRow('Vrijdag')).getByRole('button', { name: /Zalm uit de oven/ }));
    fireEvent.change(screen.getByLabelText('Ontbijt 1'), { target: { value: '31' } });
    fireEvent.click(screen.getByRole('button', { name: /Zet 1 dag op het menu/ }));

    await waitFor(() => expect(api.importMenu).toHaveBeenCalledWith({
      menu: {
        start_day: 'Donderdag',
        days: [{ day_name: 'Vrijdag', recipe_id: 1, recipe_name: 'Zalm uit de oven' }],
        breakfasts: [{ recipe_id: 31 }],
        snacks: [],
      },
      weekNumber: 45,
      year: 2026,
    }));
    expect(await screen.findByText('Week 45 staat op het menu')).toBeInTheDocument();
    expect(localStorage.getItem('weekmenu:kiezen:2026-45')).toBeNull();
  });

  it('starts from the menu already on the week, and warns that saving replaces it', async () => {
    plannerApi.get.mockResolvedValue(state({
      existing: { status: 'active', days: [{ day_name: 'Donderdag', recipe_id: 3 }], breakfasts: [], snacks: [] },
    }));
    renderPage();

    expect(await screen.findByText(/Week 45 staat al op het menu/)).toBeInTheDocument();
    expect(within(dayRow('Donderdag')).getByText('Gehaktballen')).toBeInTheDocument();
    expect(within(dayRow('Vrijdag')).getByText('Kies een recept')).toBeInTheDocument();
  });

  it('says so when no model is set up', async () => {
    plannerApi.get.mockResolvedValue(state({ configured: false }));
    renderPage();
    expect(await screen.findByText('Het taalmodel is op deze server niet ingesteld.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stel een week voor/ })).not.toBeInTheDocument();
  });
});
