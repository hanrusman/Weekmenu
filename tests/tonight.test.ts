import { describe, it, expect } from 'vitest';
import { pickTonight } from '../server/services/tonight';

const day = (id: number, date: string, status = 'approved', menu_id = 41) => ({ id, menu_id, date, status });

describe("Tonight's dinner", () => {
  it("is today's dinner when it has not been eaten", () => {
    const days = [day(1, '2026-10-12'), day(2, '2026-10-13'), day(3, '2026-10-14')];
    expect(pickTonight(days, '2026-10-13')?.id).toBe(2);
  });

  it('moves to the earliest uneaten dinner of earlier days when today\'s was eaten already', () => {
    // Week 41 as it was on 13 October: Tuesday's orzo eaten on Monday, Friday's curry still open
    const days = [
      day(84, '2026-10-08', 'completed'), day(85, '2026-10-09'), day(86, '2026-10-10', 'completed'),
      day(87, '2026-10-11', 'completed'), day(88, '2026-10-12', 'completed'), day(89, '2026-10-13', 'completed'),
      day(90, '2026-10-14'), day(91, '2026-10-15', 'approved', 42),
    ];
    expect(pickTonight(days, '2026-10-13')?.id).toBe(85);
  });

  it('takes the earliest of several open earlier days', () => {
    const days = [day(1, '2026-10-09'), day(2, '2026-10-10'), day(3, '2026-10-13', 'completed')];
    expect(pickTonight(days, '2026-10-13')?.id).toBe(1);
  });

  it('moves on to later in the same week when nothing earlier is open', () => {
    const days = [
      day(1, '2026-10-12', 'completed'), day(2, '2026-10-13', 'completed'),
      day(4, '2026-10-15', 'approved', 42), day(3, '2026-10-14'),
    ];
    expect(pickTonight(days, '2026-10-13')?.id).toBe(3);
  });

  it("does not take next week's dinner", () => {
    const days = [day(1, '2026-10-14', 'completed'), day(2, '2026-10-15', 'approved', 42)];
    expect(pickTonight(days, '2026-10-14')).toBeNull();
  });

  it('is nothing before the week starts', () => {
    expect(pickTonight([day(1, '2026-10-15')], '2026-10-13')).toBeNull();
  });
});
