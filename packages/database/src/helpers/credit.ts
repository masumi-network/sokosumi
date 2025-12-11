import { Decimal } from "decimal.js";

const CREDITS_BASE = 10 ** 12;

/**
 * Converts credit cents (stored as BigInt) to user-facing credit value.
 * @param cents - Credit amount in cents (1 credit = 10^12 cents)
 * @returns Credit value as decimal number
 */
export function convertCentsToCredits(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    // Use decimal.js
    return new Decimal(cents.toString()).div(CREDITS_BASE).toNumber();
  }
  return Number(cents) / CREDITS_BASE;
}

/**
 * Converts user-facing credit value to credit cents (stored as BigInt).
 * @param credits - Credit value as decimal number
 * @returns Credit amount in cents (1 credit = 10^12 cents)
 */
export function convertCreditsToCents(credits: number): bigint {
  return BigInt(new Decimal(credits).mul(CREDITS_BASE).toFixed(0).toString());
}

/**
 * Calculates the fee from cents based on percentage points.
 * @param cents - Credit amount in cents
 * @param percentagePoints - Fee percentage points default to 5%
 * @returns Fee in cents (rounded up to the nearest integer)
 */
export function feeFromCentsBasedOnPercentagePoints(
  cents: bigint,
  percentagePoints: number = 5,
): bigint {
  const multiplier = percentagePoints / 100;
  return BigInt(
    new Decimal(cents.toString()).mul(multiplier).toFixed(0).toString(),
  );
}
