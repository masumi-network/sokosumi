import { Decimal } from "decimal.js";

import { getEnvPublicConfig } from "@/config/env.public";

export function convertCentsToCredits(cents: bigint): number {
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    // Use decimal.js
    return new Decimal(cents.toString())
      .div(10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE)
      .toNumber();
  }
  return Number(cents) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export function convertCreditsToCents(credits: number): bigint {
  return BigInt(
    new Decimal(credits)
      .mul(10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE)
      .toFixed(0)
      .toString(),
  );
}
