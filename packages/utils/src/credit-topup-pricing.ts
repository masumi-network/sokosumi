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

/**
 * Resolves the Stripe lookup key for a credit top-up.
 *
 * @param lookupKeyOverride - SERVER-RESOLVED ONLY. Must never be populated from
 * client input: it can force the zero-margin key
 * ({@link ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY}) and bypass the volume curve.
 * Core resolves it from the authenticated user (see
 * `resolveZeroMarginLookupKeyForUser`); the web app stays margin-agnostic and
 * passes nothing.
 */
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

export interface CreditTopUpTier {
  minCredits: number;
  amountPerCredit: number;
}

/**
 * Volume breakpoints for standard credit top-up pricing, mapped to their Stripe
 * lookup keys. Single source of truth for the tier curve — keep aligned with
 * {@link getCreditTopUpLookupKeyByCredits}. A tier applies from its `minCredits`
 * (inclusive) up to the next tier's `minCredits` (exclusive).
 */
export const STANDARD_CREDIT_TOPUP_TIERS: ReadonlyArray<{
  minCredits: number;
  lookupKey: StandardCreditTopUpLookupKey;
}> = [
  { minCredits: 1, lookupKey: BASE_CREDIT_TOPUP_LOOKUP_KEY },
  { minCredits: BASE_TIER_MAX_CREDITS, lookupKey: MID_CREDIT_TOPUP_LOOKUP_KEY },
  { minCredits: MID_TIER_MAX_CREDITS, lookupKey: HIGH_CREDIT_TOPUP_LOOKUP_KEY },
];

/**
 * Picks the tier whose `minCredits` is the greatest value not exceeding
 * `credits`. Margin-free: operates purely on opaque tiers, so the web app never
 * needs to know about lookup keys or margin levels.
 */
export function selectCreditTopUpTier(
  tiers: CreditTopUpTier[],
  credits: number,
): CreditTopUpTier {
  if (!isPositiveIntegerCredits(credits)) {
    throw new Error("Credits must be a positive integer");
  }
  const sorted = [...tiers].sort((a, b) => a.minCredits - b.minCredits);
  let selected: CreditTopUpTier | undefined;
  for (const tier of sorted) {
    if (credits >= tier.minCredits) {
      selected = tier;
    }
  }
  if (!selected) {
    throw new Error("No credit top-up tier available for the given credits");
  }
  return selected;
}
