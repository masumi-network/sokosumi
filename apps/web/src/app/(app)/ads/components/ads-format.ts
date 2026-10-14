import type { createFormatter } from "next-intl";

/** What a metric shows when the provider has no value for it. */
export const NO_VALUE = "—";

type Formatter = ReturnType<typeof createFormatter>;

/**
 * How the campaigns list and a campaign's details write money, counts and
 * rates, so a number reads the same on both. A null is a dash.
 */
export function adsFormat(formatter: Formatter, currency: string) {
  return {
    money: (value: number | null) =>
      value === null
        ? NO_VALUE
        : formatter.number(value, { style: "currency", currency }),
    // Conversions can be fractional (Google attributes shares of one).
    count: (value: number | null) =>
      value === null
        ? NO_VALUE
        : formatter.number(value, { maximumFractionDigits: 1 }),
    // CTR is clicks / impressions as a fraction.
    percent: (value: number | null) =>
      value === null
        ? NO_VALUE
        : formatter.number(value, {
            style: "percent",
            maximumFractionDigits: 2,
          }),
  };
}

/**
 * A `YYYY-MM-DD` day as "Nov 3", or "Nov 3, 2026" with `year`. Core's days are
 * calendar days in the account's time zone, so they are read and shown as UTC
 * and never shift.
 */
export function adsDay(
  formatter: Formatter,
  date: string,
  { year = false }: { year?: boolean } = {},
): string {
  return formatter.dateTime(new Date(`${date}T00:00:00Z`), {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });
}
