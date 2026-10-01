/** What a metric shows when the provider has no value for it. */
export const NO_VALUE = "—";

export function formatMoney(
  value: number | null,
  currency: string,
  locale: string,
): string {
  if (value === null) return NO_VALUE;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
    value,
  );
}

export function formatCount(value: number | null, locale: string): string {
  if (value === null) return NO_VALUE;
  // Conversions can be fractional (Google attributes shares of a conversion).
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    value,
  );
}

/** CTR is clicks / impressions as a fraction, shown as a percentage. */
export function formatPercent(value: number | null, locale: string): string {
  if (value === null) return NO_VALUE;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
}

/** Decimal places the currency allows: 2 for USD, 0 for JPY. */
export function currencyFractionDigits(
  currency: string,
  locale: string,
): number {
  return (
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** The `step` of a budget input: 0.01 for USD, 1 for JPY. */
export function budgetStep(currency: string, locale: string): string {
  const digits = currencyFractionDigits(currency, locale);
  return digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
}

/** Whether `value` has no more decimal places than the currency allows. */
export function hasValidPrecision(value: number, digits: number): boolean {
  const scaled = value * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}
