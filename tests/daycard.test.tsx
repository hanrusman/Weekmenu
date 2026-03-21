import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DayCard from '../client/src/components/DayCard';
import { MenuDay } from '../client/src/lib/api';

const baseDayProps: MenuDay = {
  id: 1,
  menu_id: 1,
  day_of_week: 0,
  day_name: 'Woensdag',
  recipe_name: 'Pasta met courgette',
  recipe_data: '{}',
  meal_type: 'pasta',
  prep_time_minutes: 20,
  cost_index: '€',
  status: 'proposed',
  completed_at: null,
  notes: null,
};

describe('DayCard', () => {
  it('should render day name and recipe', () => {
    render(<DayCard day={baseDayProps} />);
    expect(screen.getByText('Woensdag')).toBeInTheDocument();
    expect(screen.getByText(/Pasta met courgette/)).toBeInTheDocument();
  });

  it('should render prep time and cost', () => {
    render(<DayCard day={baseDayProps} />);
    expect(screen.getByText('20 min')).toBeInTheDocument();
    expect(screen.getByText('€')).toBeInTheDocument();
  });

  it('should render meal type emoji for pasta', () => {
    render(<DayCard day={baseDayProps} />);
    expect(screen.getByText(/🍝/)).toBeInTheDocument();
  });

  it('should show VANDAAG when isToday is true', () => {
    render(<DayCard day={baseDayProps} isToday />);
    expect(screen.getByText(/VANDAAG/)).toBeInTheDocument();
  });

  it('should show approve button when showActions is true and status is proposed', () => {
    const onApprove = vi.fn();
    render(<DayCard day={baseDayProps} showActions onApprove={onApprove} />);
    expect(screen.getByText(/Goedkeuren/)).toBeInTheDocument();
  });

  it('should not show Goedkeuren when already approved', () => {
    const day = { ...baseDayProps, status: 'approved' };
    render(<DayCard day={day} showActions />);
    expect(screen.queryByText(/Goedkeuren/)).not.toBeInTheDocument();
  });

  it('should call onApprove when clicked', () => {
    const onApprove = vi.fn();
    render(<DayCard day={baseDayProps} showActions onApprove={onApprove} />);
    fireEvent.click(screen.getByText(/Goedkeuren/));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('should not show actions for completed days', () => {
    const day = { ...baseDayProps, status: 'completed' };
    render(<DayCard day={day} showActions isCompleted />);
    expect(screen.queryByText(/Goedkeuren/)).not.toBeInTheDocument();
  });

  it('should apply strikethrough to completed day recipe name', () => {
    const day = { ...baseDayProps, status: 'completed' };
    render(<DayCard day={day} isCompleted />);
    const recipeName = screen.getByText(/Pasta met courgette/);
    expect(recipeName.className).toContain('line-through');
  });

  it('should call onClick when card is clicked', () => {
    const onClick = vi.fn();
    render(<DayCard day={baseDayProps} onClick={onClick} />);
    fireEvent.click(screen.getByText(/Pasta met courgette/));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('should render different meal type emojis', () => {
    const meals = [
      { type: 'rijst', emoji: '🍚' },
      { type: 'wrap', emoji: '🌯' },
      { type: 'oven', emoji: '🫕' },
      { type: 'salade', emoji: '🥗' },
    ];

    for (const { type, emoji } of meals) {
      const { unmount } = render(<DayCard day={{ ...baseDayProps, meal_type: type }} />);
      expect(screen.getByText(new RegExp(emoji))).toBeInTheDocument();
      unmount();
    }
  });
});
