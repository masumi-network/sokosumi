import { Decimal } from "decimal.js";

const CREDITS_BASE = 10 ** 10;
export const FREE_CREDITS_EXPIRY_DAYS = 30;

export function convertCentsToCredits(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    return new Decimal(cents.toString()).div(CREDITS_BASE).toNumber();
  }

  return Number(cents) / CREDITS_BASE;
}

export function convertCreditsToCents(credits: number): bigint {
  if (!Number.isFinite(credits)) {
    throw new Error("Credits must be a finite number");
  }

  return BigInt(new Decimal(credits).mul(CREDITS_BASE).toFixed(0).toString());
}
