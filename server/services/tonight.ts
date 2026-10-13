/** What a menu day needs for choosing tonight's dinner. */
export interface PlannedDay {
  id: number;
  menu_id: number;
  date: string | null;
  status: string;
}

/**
 * Tonight's dinner among the days of the active menus. The family swaps days
 * when that suits them, so the day planned for today may already be eaten:
 * - today's dinner, when it has not been eaten;
 * - else the earliest dinner from earlier days that has not been eaten;
 * - else the next uneaten dinner later in today's week.
 * Null when nothing is left (or no week is running). When a dinner was
 * ticked off says nothing here: the family often ticks off days later.
 */
export function pickTonight<T extends PlannedDay>(days: T[], today: string): T | null {
  const byDate = (a: T, b: T) => a.date!.localeCompare(b.date!);
  const open = days.filter((d) => d.status !== 'completed' && d.date);

  const planned = days.find((d) => d.date === today);
  if (planned && planned.status !== 'completed') return planned;

  const earlier = open.filter((d) => d.date! < today).sort(byDate)[0];
  if (earlier) return earlier;

  if (!planned) return null;
  return open.filter((d) => d.menu_id === planned.menu_id && d.date! > today).sort(byDate)[0] ?? null;
}
