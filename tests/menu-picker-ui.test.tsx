import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { DraftDay, PlannerRecipe } from '../shared/menu-rules';
import type { PlannerState, ProposalJob } from '../shared/menu-planner';

const api = { importMenu: vi.fn() };
const plannerApi = { get: vi.fn(), propose: vi.fn(), proposal: vi.fn(), chat: vi.fn() };
vi.mock('../client/src/lib/api', async (original) => ({
  ...(await original<typeof import('../client/src/lib/api')>()),
  api,
  plannerApi,
}));

const { default: MenuPicker } = await import('../client/src/pages/MenuPicker');

function dinner(id: number, name: string, fields: Partial<PlannerRecipe> = {}): PlannerRecipe {
  return {
    id, name, status: 'goedgekeurd', meal_type: name, prep_time_minutes: 25, cost_index: '€', protein: [],
    veg_per_serving: 360, veg_exception: false, meal_missing: [], rating_avg: null, rating_count: 0, recent_weeks: [],
    last_used: null, recipe_image_version: null, ingredients: [], ...fields,
  };
}

const recipes = [
  dinner(1, 'Zalm uit de oven', { protein: ['vis'] }),
  dinner(2, 'Linzensoep', { protein: ['peulvruchten'] }),
  dinner(3, 'Gehaktballen', { protein: ['vlees'], prep_time_minutes: 45 }),
  dinner(4, 'Pasta pesto', { veg_per_serving: 200, meal_missing: ['eiwit'] }),
  dinner(5, 'Kabeljauw met prei', { protein: ['vis'] }),
  dinner(6, 'Kikkererwtencurry', { protein: ['peulvruchten'] }),
  dinner(7, 'Wraps met kip', { protein: ['vlees'] }),
  dinner(8, 'Shakshuka'),
  dinner(9, 'Groentesoep met brood'),
];
const names = recipes.map((r) => r.name);

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

/** A draft as this browser keeps it: these recipes on the days, null for open. */
function stored(ids: Array<number | null>, fields: Partial<DraftDay>[] = []) {
  localStorage.setItem('weekmenu:kiezen:2026-45', JSON.stringify({
    days: DAYS.map((day_name, i) => ({ day_name, date: null, recipe_id: ids[i] ?? null, ...fields[i] })),
    breakfasts: [], snacks: [], note: null, applied: null,
  }));
}

const renderPage = () => render(
  <MemoryRouter initialEntries={['/plannen/kiezen']}>
    <Routes><Route path="/plannen/kiezen" element={<MenuPicker />} /></Routes>
  </MemoryRouter>,
);

/** The card of a day, by its short name ("do" for Donderdag). */
const dayRow = (name: string) => screen.getByText(name.slice(0, 2).toLowerCase(), { selector: 'span' }).closest('li')!;
/** The dinner on a day as the card shows it. */
const dinnerOn = (name: string) => {
  const text = within(dayRow(name)).getAllByRole('button')[0].textContent ?? '';
  return names.find((n) => text.includes(n)) ?? null;
};
const openDay = (name: string) => fireEvent.click(within(dayRow(name)).getAllByRole('button')[0]);
const action = (name: string, label: string | RegExp) => fireEvent.click(within(dayRow(name)).getByRole('button', { name: label }));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('menu picker', () => {
  it('puts a new week ready within the rules, breakfasts too, and keeps it', async () => {
    plannerApi.get.mockResolvedValue(state());
    renderPage();

    expect(await screen.findByText('De week staat klaar volgens jullie kaders. Tik op een dag om iets te veranderen.')).toBeInTheDocument();
    const week = DAYS.map(dinnerOn);
    expect(week.every((n) => n !== null)).toBe(true);
    expect(new Set(week).size).toBe(7);
    expect(week).not.toContain('Pasta pesto');
    expect(screen.queryByText('Buiten de kaders')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Ontbijt 1')).toHaveValue('31');
    // Kept in this browser, so coming back shows the same week
    const kept = JSON.parse(localStorage.getItem('weekmenu:kiezen:2026-45')!);
    expect(kept.days.map((d: DraftDay) => recipes.find((r) => r.id === d.recipe_id)?.name)).toEqual(week);
  });

  it('chooses a new recipe for a day, a different one each time', async () => {
    plannerApi.get.mockResolvedValue(state());
    renderPage();
    await screen.findByText('Week 45');

    const first = dinnerOn('Donderdag');
    openDay('Donderdag');
    action('Donderdag', 'Kies nieuw recept');
    const second = dinnerOn('Donderdag');
    action('Donderdag', 'Kies nieuw recept');
    const third = dinnerOn('Donderdag');
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
    // Out of fitting alternatives (most are on other days): back to the best, not one outside the rules
    expect([second, third]).not.toContain('Pasta pesto');
  });

  it('cooks a smaller portion on a day, and saves it', async () => {
    stored([1, 2, 3, 5, 6, 7, 8]);
    plannerApi.get.mockResolvedValue(state());
    api.importMenu.mockResolvedValue({});
    renderPage();
    await screen.findByText('Week 45');

    openDay('Vrijdag');
    action('Vrijdag', 'Verklein portie');
    fireEvent.click(screen.getByRole('button', { name: '2 personen' }));
    expect(within(dayRow('Vrijdag')).getByText('voor 2 ·')).toBeInTheDocument();
    expect(within(dayRow('Vrijdag')).getByRole('button', { name: 'Portie: voor 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Zet 7 dagen op het menu/ }));
    await waitFor(() => expect(api.importMenu).toHaveBeenCalled());
    const days = api.importMenu.mock.calls[0][0].menu.days;
    expect(days[1]).toEqual({ day_name: 'Vrijdag', recipe_id: 2, recipe_name: 'Linzensoep', servings: 2 });
    expect(days[0]).toEqual({ day_name: 'Donderdag', recipe_id: 1, recipe_name: 'Zalm uit de oven' });
  });

  it('swaps two days, with their portions', async () => {
    stored([1, 2, 3, 5, 6, 7, 8], [{}, { servings: 2 }]);
    plannerApi.get.mockResolvedValue(state());
    renderPage();
    await screen.findByText('Week 45');

    openDay('Donderdag');
    action('Donderdag', 'Wissel van dag');
    fireEvent.click(screen.getByRole('button', { name: 'vr · Linzensoep' }));
    expect(dinnerOn('Donderdag')).toBe('Linzensoep');
    expect(dinnerOn('Vrijdag')).toBe('Zalm uit de oven');
    expect(within(dayRow('Donderdag')).getByText('voor 2 ·')).toBeInTheDocument();
  });

  it('skips a day, which is left out on saving, and plans it again', async () => {
    stored([1, 2, 3, 5, 6, 7, 8]);
    plannerApi.get.mockResolvedValue(state());
    api.importMenu.mockResolvedValue({});
    renderPage();
    await screen.findByText('Week 45');

    openDay('Zondag');
    action('Zondag', 'Sla deze dag over');
    expect(within(dayRow('Zondag')).getByText('Overgeslagen, geen avondeten')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zet 6 dagen op het menu/ })).toBeInTheDocument();

    openDay('Zondag');
    action('Zondag', 'Toch plannen');
    expect(dinnerOn('Zondag')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Zet 7 dagen op het menu/ })).toBeInTheDocument();
  });

  it('asks the assistant for a dinner with a wish, and picks one of its proposals', async () => {
    stored([1, 3, 5, 6, 7, 8, 9]);
    plannerApi.get.mockResolvedValue(state());
    plannerApi.chat.mockResolvedValueOnce({
      reply: 'Linzensoep past mooi, en telt mee voor peulvruchten.',
      suggestions: [{ recipe_id: 2, reason: 'Met rode linzen.' }], model: 'cloud-gemma',
    });
    renderPage();
    await screen.findByText('Week 45');

    openDay('Zaterdag');
    action('Zaterdag', 'Vraag de assistent');
    fireEvent.change(screen.getByLabelText('Vraag de assistent iets voor zaterdag'), { target: { value: 'Iets met linzen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));

    expect(await screen.findByText('Linzensoep past mooi, en telt mee voor peulvruchten.')).toBeInTheDocument();
    expect(screen.getByText('Met rode linzen.')).toBeInTheDocument();
    expect(plannerApi.chat).toHaveBeenCalledWith({
      week_number: 45, year: 2026, day_name: 'Zaterdag',
      days: DAYS.map((day_name, i) => ({ day_name, recipe_id: [1, 3, 5, 6, 7, 8, 9][i], free: undefined })),
      messages: [{ role: 'user', content: 'Iets met linzen' }],
    });

    // A follow-up carries the conversation, the proposal included
    plannerApi.chat.mockResolvedValueOnce({ reply: 'Dan deze.', suggestions: [{ recipe_id: 6, reason: '' }], model: 'cloud-gemma' });
    fireEvent.change(screen.getByLabelText('Vraag de assistent iets voor zaterdag'), { target: { value: 'Liever iets met curry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await screen.findByText('Dan deze.');
    expect(plannerApi.chat.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: 'Iets met linzen' },
      { role: 'assistant', content: 'Linzensoep past mooi, en telt mee voor peulvruchten.', suggestions: [2] },
      { role: 'user', content: 'Liever iets met curry' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Kies Linzensoep' }));
    expect(dinnerOn('Zaterdag')).toBe('Linzensoep');
    expect(JSON.parse(localStorage.getItem('weekmenu:kiezen:2026-45')!).days[2]).toMatchObject({ recipe_id: 2, chosen: true });
  });

  it('says what went wrong with the assistant, and keeps the question', async () => {
    stored([1, 2, 3, 5, 6, 7, 8]);
    plannerApi.get.mockResolvedValue(state());
    plannerApi.chat.mockRejectedValue(new Error('De assistent gaf geen antwoord (het duurde te lang); probeer het nog eens'));
    renderPage();
    await screen.findByText('Week 45');

    openDay('Donderdag');
    action('Donderdag', 'Vraag de assistent');
    fireEvent.change(screen.getByLabelText('Vraag de assistent iets voor donderdag'), { target: { value: 'Iets snels' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    expect(await screen.findByText(/het duurde te lang/)).toBeInTheDocument();
    expect(screen.getByText('Iets snels')).toBeInTheDocument();
  });

  it('keeps the days chosen by hand when the week is put ready again', async () => {
    stored([1, 2, 3, 5, 6, 7, 8], [{ chosen: true }]);
    plannerApi.get.mockResolvedValue(state());
    renderPage();
    await screen.findByText('Week 45');

    fireEvent.click(screen.getByRole('button', { name: /Nieuw voorstel/ }));
    expect(dinnerOn('Donderdag')).toBe('Zalm uit de oven');
    expect(DAYS.map(dinnerOn).every((n) => n !== null)).toBe(true);
  });

  it('starts from the menu already on the week, its portions and skipped days included, and warns that saving replaces it', async () => {
    plannerApi.get.mockResolvedValue(state({
      existing: {
        status: 'active', saved_at: '2026-10-28T10:05:00.000Z',
        days: [{ day_name: 'Donderdag', recipe_id: 3, servings: 2 }], breakfasts: [], snacks: [],
      },
    }));
    renderPage();

    expect(await screen.findByText(/Week 45 staat al op het menu/)).toBeInTheDocument();
    expect(dinnerOn('Donderdag')).toBe('Gehaktballen');
    expect(within(dayRow('Donderdag')).getByText('voor 2 ·')).toBeInTheDocument();
    // A day the saved week does not have was skipped
    expect(within(dayRow('Vrijdag')).getByText('Overgeslagen, geen avondeten')).toBeInTheDocument();
  });

  it('lets the assistant choose the whole week, keeping the days chosen by hand', async () => {
    stored([1, 2, 3, 5, 6, 7, 8], [{ chosen: true }]);
    plannerApi.get.mockResolvedValue(state());
    plannerApi.propose.mockResolvedValue({ job: job({ running: true, attempt: 1, model: 'cloud-glm', week_number: 45, year: 2026 }) });
    renderPage();
    await screen.findByText('Week 45');

    fireEvent.click(screen.getByText('Meer'));
    fireEvent.change(screen.getByLabelText('Wensen voor deze week'), { target: { value: 'iets met pompoen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kies' }));

    await waitFor(() => expect(plannerApi.propose).toHaveBeenCalled());
    const body = plannerApi.propose.mock.calls[0][0];
    expect(body.wishes).toBe('iets met pompoen');
    expect(body.days[0]).toEqual({ day_name: 'Donderdag', recipe_id: 1, free: undefined });
    expect(body.days[1]).toEqual({ day_name: 'Vrijdag', recipe_id: null, free: undefined });
    expect(await screen.findByText('De assistent kiest de open dagen…')).toBeInTheDocument();
    expect(within(dayRow('Vrijdag')).getByText('Kies een recept')).toBeInTheDocument();
  });

  it('does not bring a handled proposal back once the week is saved, and keeps a skipped day skipped', async () => {
    const proposal = {
      days: DAYS.map((day_name, i) => ({ day_name, date: null, recipe_id: i === 0 ? 1 : i === 1 ? 2 : null })),
      breakfasts: [31], snacks: [], note: 'Vis en peulvruchten.', model: 'cloud-glm', fails: [], warnings: [],
    };
    const finished = job({
      week_number: 45, year: 2026, started_at: '2026-10-28T10:00:00.000Z', finished_at: '2026-10-28T10:02:00.000Z', proposal,
    });
    stored([null, null, 3, 5, 6, 7, 8]);
    plannerApi.get.mockResolvedValue(state({ job: finished }));
    api.importMenu.mockResolvedValue({});
    const first = renderPage();
    fireEvent.click(await screen.findByText('Meer'));
    expect(await screen.findByText('Vis en peulvruchten.')).toBeInTheDocument();
    expect(dinnerOn('Donderdag')).toBe('Zalm uit de oven');

    openDay('Donderdag');
    action('Donderdag', 'Sla deze dag over');
    fireEvent.click(screen.getByRole('button', { name: /Zet 6 dagen op het menu/ }));
    await screen.findByText('Week 45 staat op het menu');
    first.unmount();

    // Opened again: the saved week, and the same finished proposal on the server
    plannerApi.get.mockResolvedValue(state({
      job: finished,
      existing: {
        status: 'active', saved_at: '2026-10-28T10:05:00.000Z',
        days: [{ day_name: 'Vrijdag', recipe_id: 2, servings: null }], breakfasts: [], snacks: [],
      },
    }));
    renderPage();
    expect(await screen.findByText(/Week 45 staat al op het menu/)).toBeInTheDocument();
    expect(within(dayRow('Donderdag')).getByText('Overgeslagen, geen avondeten')).toBeInTheDocument();
    expect(dinnerOn('Vrijdag')).toBe('Linzensoep');
    expect(screen.getByLabelText('Ontbijt 1')).toHaveValue('');
  });

  it('keeps following a proposal after a failed status request', async () => {
    vi.useFakeTimers();
    try {
      stored([null, 2, 3, 5, 6, 7, 8]);
      const running = job({ running: true, attempt: 1, model: 'cloud-glm', week_number: 45, year: 2026, started_at: '2026-10-28T10:00:00.000Z' });
      plannerApi.get.mockResolvedValue(state({ job: running }));
      plannerApi.proposal
        .mockRejectedValueOnce(new Error('Failed to fetch'))
        .mockResolvedValue({ job: {
          ...running, running: false, finished_at: '2026-10-28T10:02:00.000Z',
          proposal: {
            days: DAYS.map((day_name, i) => ({ day_name, date: null, recipe_id: i === 0 ? 1 : null })),
            breakfasts: [], snacks: [], note: 'Klaar.', model: 'cloud-glm', fails: [], warnings: [],
          },
        } });
      renderPage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(screen.getByText('De assistent kiest de open dagen…')).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(plannerApi.proposal).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByText('Meer'));
      expect(screen.getByText(/Geen verbinding met de server/)).toBeInTheDocument();

      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(plannerApi.proposal).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Klaar.')).toBeInTheDocument();
      expect(dinnerOn('Donderdag')).toBe('Zalm uit de oven');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves out the assistant when no model is set up', async () => {
    stored([1, 2, 3, 5, 6, 7, 8]);
    plannerApi.get.mockResolvedValue(state({ configured: false }));
    renderPage();
    await screen.findByText('Week 45');

    openDay('Donderdag');
    expect(within(dayRow('Donderdag')).getByRole('button', { name: 'Vraag de assistent' })).toBeDisabled();
    expect(screen.getByText('De assistent is op deze server niet ingesteld.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Meer'));
    expect(screen.queryByLabelText('Wensen voor deze week')).not.toBeInTheDocument();
  });
});
