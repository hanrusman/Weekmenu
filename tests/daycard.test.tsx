import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DayCard from '../client/src/components/DayCard';
import TodayCard from '../client/src/components/TodayCard';
import { StarInput } from '../client/src/components/Stars';
import { api, MenuDay } from '../client/src/lib/api';

const day: MenuDay = {
  id: 1,
  menu_id: 1,
  day_of_week: 0,
  day_name: 'Dinsdag',
  date: '2026-10-13',
  recipe_name: 'Pasta met courgette',
  recipe_data: '{}',
  meal_type: 'pasta',
  prep_time_minutes: 20,
  cost_index: '€',
  status: 'approved',
  completed_at: null,
  notes: null,
};

afterEach(() => vi.restoreAllMocks());

describe('DayCard', () => {
  it('shows the short date, the recipe and the time', () => {
    render(<DayCard day={day} />);
    expect(screen.getByText('di 13 okt')).toBeInTheDocument();
    expect(screen.getByText('Pasta met courgette')).toBeInTheDocument();
    expect(screen.getByText(/20 min/)).toBeInTheDocument();
  });

  it('shows the stars of a dinner that was eaten and rated', () => {
    render(<DayCard day={{ ...day, status: 'completed', stars: 4 }} isCompleted />);
    expect(screen.getByRole('img', { name: '4 van 5 sterren' })).toBeInTheDocument();
  });

  it('opens on click', () => {
    const onClick = vi.fn();
    render(<DayCard day={day} onClick={onClick} />);
    fireEvent.click(screen.getByText('Pasta met courgette'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('shows the meal emoji without a picture', () => {
    render(<DayCard day={{ ...day, recipe_name: 'Iets onbekends', meal_type: 'rijst' }} />);
    expect(screen.getByText('🍚')).toBeInTheDocument();
  });
});

describe('StarInput', () => {
  it('gives the number of stars tapped, with its word', () => {
    const onChange = vi.fn();
    render(<StarInput value={3} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: /3 sterren/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Prima')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /5 sterren/ }));
    expect(onChange).toHaveBeenCalledWith(5);
  });
});

describe('TodayCard', () => {
  it('saves the last of two quick ratings, also when the first request is slow', async () => {
    const eaten: MenuDay = { ...day, status: 'completed' };
    let releaseFirst!: () => void;
    const getFeedback = vi.spyOn(api, 'getDayFeedback')
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(null); }))
      .mockResolvedValue(null);
    const saved: number[] = [];
    vi.spyOn(api, 'saveFeedback').mockImplementation(async (_m, _d, stars) => {
      saved.push(stars);
      return { id: 1, day_id: 1, stars, notes: null, created_at: '' };
    });
    const onChange = vi.fn();

    render(<MemoryRouter><TodayCard day={eaten} onChange={onChange} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('radio', { name: /2 sterren/ }));
    await waitFor(() => expect(getFeedback).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('radio', { name: /5 sterren/ }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ stars: 5 }));

    releaseFirst();
    await waitFor(() => expect(saved.at(-1)).toBe(5));
    // The slow first rating is not sent after it was replaced
    expect(saved).toEqual([5]);
  });

  it('ticks tonight off and then rates it, keeping a note', async () => {
    const complete = vi.spyOn(api, 'completeDay').mockResolvedValue({ ...day, status: 'completed' });
    vi.spyOn(api, 'getDayFeedback').mockResolvedValue({ id: 1, day_id: 1, stars: 2, notes: 'Te zout', created_at: '' });
    const save = vi.spyOn(api, 'saveFeedback').mockResolvedValue({ id: 1, day_id: 1, stars: 4, notes: 'Te zout', created_at: '' });
    const onChange = vi.fn();

    const { rerender } = render(<MemoryRouter><TodayCard day={day} onChange={onChange} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Gegeten/ }));
    await waitFor(() => expect(complete).toHaveBeenCalledWith(1, 1));
    const eaten = onChange.mock.calls[0][0] as MenuDay;
    expect(eaten.status).toBe('completed');

    rerender(<MemoryRouter><TodayCard day={eaten} onChange={onChange} /></MemoryRouter>);
    expect(screen.getByText('Hoe was het?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /4 sterren/ }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(1, 1, 4, 'Te zout'));
  });
});
