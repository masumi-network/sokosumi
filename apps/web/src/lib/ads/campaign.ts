import type { CreateAdCampaignRequest } from "@sokosumi/core-client";

/** Objectives Core accepts for a new Meta campaign. */
export const AD_CAMPAIGN_OBJECTIVES = [
  "OUTCOME_TRAFFIC",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
  "OUTCOME_LEADS",
  "OUTCOME_SALES",
] as const satisfies readonly NonNullable<
  CreateAdCampaignRequest["objective"]
>[];

/** Decimal places the currency allows: 2 for USD, 0 for JPY. */
export function currencyFractionDigits(currency: string): number {
  // The digits belong to the currency, not the locale, so no text is rendered
  // from this formatter (rendered amounts use `useFormatter`).
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** The `step` of a budget input: 0.01 for USD, 1 for JPY. */
export function budgetStep(digits: number): string {
  return digits === 0 ? "1" : `0.${"0".repeat(digits - 1)}1`;
}

/** Whether `value` has no more decimal places than the currency allows. */
export function hasValidPrecision(value: number, digits: number): boolean {
  const scaled = value * 10 ** digits;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}
