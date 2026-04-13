export const ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY = "credit_0_margin";
export const BASE_CREDIT_TOPUP_LOOKUP_KEY = "credit_20_margin";
export const MID_CREDIT_TOPUP_LOOKUP_KEY = "credit_15_margin";
export const HIGH_CREDIT_TOPUP_LOOKUP_KEY = "credit_10_margin";

export const CREDIT_TOPUP_LOOKUP_KEYS = [
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  MID_CREDIT_TOPUP_LOOKUP_KEY,
  HIGH_CREDIT_TOPUP_LOOKUP_KEY,
] as const;

const BASE_TIER_MAX_CREDITS = 10_000;
const MID_TIER_MAX_CREDITS = 100_000;

export type StandardCreditTopUpLookupKey =
  (typeof CREDIT_TOPUP_LOOKUP_KEYS)[number];

export type CreditTopUpLookupKey =
  | StandardCreditTopUpLookupKey
  | typeof ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY;

export function isPositiveIntegerCredits(credits: number): boolean {
  return Number.isFinite(credits) && Number.isInteger(credits) && credits > 0;
}

/**
 * Total charge for a credit top-up in the smallest currency unit (Stripe minor units).
 * Must stay aligned with checkout line-item amount computation.
 */
export function getCreditTopUpTotalMinorUnits(
  credits: number,
  amountPerCredit: number,
): number {
  const totalMinorUnits = Math.ceil(credits * amountPerCredit);

  if (!Number.isFinite(totalMinorUnits) || totalMinorUnits < 1) {
    throw new Error("Computed credit top-up total is invalid");
  }

  return totalMinorUnits;
}

export function getCreditTopUpLookupKeyByCredits(
  credits: number,
  lookupKeyOverride?: CreditTopUpLookupKey,
): CreditTopUpLookupKey {
  if (!isPositiveIntegerCredits(credits)) {
    throw new Error("Credits must be a positive integer");
  }

  if (lookupKeyOverride) {
    return lookupKeyOverride;
  }

  if (credits < BASE_TIER_MAX_CREDITS) {
    return BASE_CREDIT_TOPUP_LOOKUP_KEY;
  }

  if (credits < MID_TIER_MAX_CREDITS) {
    return MID_CREDIT_TOPUP_LOOKUP_KEY;
  }

  return HIGH_CREDIT_TOPUP_LOOKUP_KEY;
}
