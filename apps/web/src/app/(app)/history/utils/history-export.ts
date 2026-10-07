import type { HistoryFilters } from "@/app/history/utils/history-filters";

export interface ExportRange {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

function toDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** First and last UTC day of the month `monthsAgo` before `now`'s month. */
export function monthRange(now: Date, monthsAgo: number): ExportRange {
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - monthsAgo,
    1,
  );
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - monthsAgo + 1,
    1,
  );
  return { from: toDay(start), to: toDay(next - DAY_MS) };
}

export function lastDaysRange(now: Date, days: number): ExportRange {
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return { from: toDay(end - (days - 1) * DAY_MS), to: toDay(end) };
}

/** The range for an `<input type="month">` value, `YYYY-MM`. */
export function namedMonthRange(value: string): ExportRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  const next = Date.UTC(Number(match[1]), Number(match[2]), 1);
  return { from: toDay(start), to: toDay(next - DAY_MS) };
}

export function buildExportHref(
  range: ExportRange,
  filters: HistoryFilters,
): string {
  const params = new URLSearchParams({ from: range.from, to: range.to });
  if (filters.q) params.set("q", filters.q);
  params.set("scope", filters.scope);
  if (filters.type) params.set("types", filters.type);
  if (filters.projectId) params.set("projectId", filters.projectId);
  return `/api/transactions/export?${params.toString()}`;
}
