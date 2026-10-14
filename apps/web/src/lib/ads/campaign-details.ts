/**
 * "UNDER_REVIEW" as "Under review". Only the fallback for a value Google adds
 * later; every documented value has translated copy (see `enumLabel`).
 */
export function humanizeEnum(value: string): string {
  const words = value.replaceAll("_", " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The translated label of a raw Google value when `known` lists it. Every
 * documented value has copy; the humanized value is only the fallback for one
 * Google adds later, so it never shows as SCREAMING_CASE.
 */
export function enumLabel<K extends string>(
  value: string,
  known: readonly K[],
  label: (key: K) => string,
): string {
  const key = known.find((candidate) => candidate === value);
  return key ? label(key) : humanizeEnum(value);
}

/** Ad strengths with copy under `App.Ads.campaignDetails.ad.strengths`. */
export const AD_STRENGTHS = [
  "PENDING",
  "NO_ADS",
  "POOR",
  "AVERAGE",
  "GOOD",
  "EXCELLENT",
] as const;

/** Review statuses with copy under `App.Ads.campaignDetails.ad.review`. */
export const REVIEW_STATUSES = [
  "REVIEW_IN_PROGRESS",
  "REVIEWED",
  "UNDER_APPEAL",
  "ELIGIBLE_MAY_SERVE",
] as const;

/** Bidding strategies with copy under `App.Ads.campaignDetails.bidding`. */
export const BIDDING_STRATEGIES = [
  "TARGET_SPEND",
  "MANUAL_CPC",
  "ENHANCED_CPC",
  "MANUAL_CPM",
  "TARGET_CPM",
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_CPA",
  "TARGET_ROAS",
  "TARGET_IMPRESSION_SHARE",
] as const;

/** Approval statuses with copy under `App.Ads.campaignDetails.approval`. */
export const APPROVAL_STATUSES = [
  "APPROVED",
  "APPROVED_LIMITED",
  "AREA_OF_INTEREST_ONLY",
  "DISAPPROVED",
  "PENDING_REVIEW",
  "UNDER_REVIEW",
] as const;

/** Google's "no value" statuses, which say nothing worth showing. */
const EMPTY_STATUSES: ReadonlySet<string> = new Set(["UNSPECIFIED", "UNKNOWN"]);

/** A status worth showing: none when it is missing or one of Google's empty ones. */
export function meaningfulStatus(status: string | null): string | null {
  return status === null || EMPTY_STATUSES.has(status) ? null : status;
}

/**
 * The approval status worth showing: none for a missing or empty one and none
 * for APPROVED, which is the normal state and needs no words.
 */
export function problemApproval(status: string | null): string | null {
  const meaningful = meaningfulStatus(status);
  return meaningful === "APPROVED" ? null : meaningful;
}
