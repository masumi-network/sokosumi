import { Decimal } from "decimal.js";

const CREDIT_BASE = 10 ** 12;

/**
 * Converts credit cents (stored as BigInt) to user-facing credit value.
 * @param cents - Credit amount in cents (1 credit = 10^12 cents)
 * @returns Credit value as decimal number
 */
export function convertCentsToCredits(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    return new Decimal(cents.toString()).div(10 ** 12).toNumber();
  }
  return Number(cents) / CREDIT_BASE;
}

/**
 * Converts user-facing credit value to credit cents (stored as BigInt).
 * @param credits - Credit value as decimal number
 * @returns Credit amount in cents (1 credit = 10^12 cents)
 */
export function convertCreditsToCents(credits: number): bigint {
  return BigInt(new Decimal(credits).mul(CREDIT_BASE).toFixed(0).toString());
}
