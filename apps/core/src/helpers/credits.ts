import { Decimal } from "decimal.js";

export function convertCentsToCredits(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    return new Decimal(cents.toString()).div(10 ** 12).toNumber();
  }
  return Number(cents) / 10 ** 12;
}

export function convertCreditsToCents(credits: number): bigint {
  return BigInt(
    new Decimal(credits)
      .mul(10 ** 12)
      .toFixed(0)
      .toString(),
  );
}
