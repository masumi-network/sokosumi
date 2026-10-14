/** "UNDER_REVIEW" as "Under review", for a value Core passes through raw. */
export function humanizeEnum(value: string): string {
  const words = value.replaceAll("_", " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The translated label of a raw Google value when `known` lists it, else the
 * humanized value, so a value Google adds later never shows as SCREAMING_CASE.
 */
export function enumLabel<K extends string>(
  value: string,
  known: readonly K[],
  label: (key: K) => string,
): string {
  const key = known.find((candidate) => candidate === value);
  return key ? label(key) : humanizeEnum(value);
}

/** Approval statuses with copy under `App.Ads.campaignDetails.approval`. */
export const APPROVAL_STATUSES = [
  "APPROVED",
  "APPROVED_LIMITED",
  "DISAPPROVED",
  "PENDING_REVIEW",
  "UNDER_REVIEW",
] as const;

/** Google's "no value" statuses, which say nothing worth showing. */
const EMPTY_STATUSES: ReadonlySet<string> = new Set(["UNSPECIFIED", "UNKNOWN"]);

/**
 * The approval status worth showing: none for a missing or empty one and none
 * for APPROVED, which is the normal state and needs no words.
 */
export function problemApproval(status: string | null): string | null {
  return status === null || status === "APPROVED" || EMPTY_STATUSES.has(status)
    ? null
    : status;
}

/** A status worth showing: none when it is missing or one of Google's empty ones. */
export function meaningfulStatus(status: string | null): string | null {
  return status === null || EMPTY_STATUSES.has(status) ? null : status;
}
