import { Temporal } from "temporal-polyfill";

/**
 * The ISO 8601 week a month-grid row shows, from its first day (`yyyy-MM-dd`).
 *
 * ISO weeks run Monday to Sunday, so a row that starts on a Sunday is
 * numbered by the Monday after it, not by the Sunday that closes the week
 * before.
 */
export function isoWeekOfRow(rowStartKey: string): number {
  const start = Temporal.PlainDate.from(rowStartKey);
  // `dayOfWeek` is 1 (Monday) to 7 (Sunday); step forward to the row's Monday.
  const monday = start.add({ days: (8 - start.dayOfWeek) % 7 });
  return monday.weekOfYear ?? 0;
}
