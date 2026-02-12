export const BASE_CREDIT_TOPUP_LOOKUP_KEY = "credit_20_margin";
export const MID_CREDIT_TOPUP_LOOKUP_KEY = "credit_15_margin";
export const HIGH_CREDIT_TOPUP_LOOKUP_KEY = "credit_10_margin";
export const TOPUP_CREDITS_PER_STRIPE_UNIT = 100;

export const CREDIT_TOPUP_LOOKUP_KEYS = [
  BASE_CREDIT_TOPUP_LOOKUP_KEY,
  MID_CREDIT_TOPUP_LOOKUP_KEY,
  HIGH_CREDIT_TOPUP_LOOKUP_KEY,
] as const;

const BASE_TIER_MAX_CREDITS = 10_000;
const MID_TIER_MAX_CREDITS = 100_000;

export type CreditTopUpLookupKey = (typeof CREDIT_TOPUP_LOOKUP_KEYS)[number];

export function isPositiveIntegerCredits(credits: number): boolean {
  return Number.isFinite(credits) && Number.isInteger(credits) && credits > 0;
}

export function isStripeUnitAlignedCredits(credits: number): boolean {
  return (
    isPositiveIntegerCredits(credits) &&
    credits % TOPUP_CREDITS_PER_STRIPE_UNIT === 0
  );
}

export function convertCreditsToStripeUnits(credits: number): number {
  if (!isStripeUnitAlignedCredits(credits)) {
    throw new Error(
      `Credits must be a positive integer multiple of ${TOPUP_CREDITS_PER_STRIPE_UNIT}`,
    );
  }

  return credits / TOPUP_CREDITS_PER_STRIPE_UNIT;
}

export function convertStripeUnitsToCredits(units: number): number {
  if (!Number.isFinite(units) || !Number.isInteger(units) || units < 0) {
    throw new Error("Stripe units must be a non-negative integer");
  }

  return units * TOPUP_CREDITS_PER_STRIPE_UNIT;
}

export function getCreditTopUpLookupKeyByCredits(
  credits: number,
): CreditTopUpLookupKey {
  if (!isPositiveIntegerCredits(credits)) {
    throw new Error("Credits must be a positive integer");
  }

  if (credits < BASE_TIER_MAX_CREDITS) {
    return BASE_CREDIT_TOPUP_LOOKUP_KEY;
  }

  if (credits < MID_TIER_MAX_CREDITS) {
    return MID_CREDIT_TOPUP_LOOKUP_KEY;
  }

  return HIGH_CREDIT_TOPUP_LOOKUP_KEY;
}
