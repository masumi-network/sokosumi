import { getEnvPublicConfig } from "@/config/env.public";

export function convertCentsToCredits(cents: bigint): number {
  return Number(cents) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export function convertCreditsToCents(credits: number): bigint {
  return BigInt(credits * 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE);
}
