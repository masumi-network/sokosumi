import { getEnvPublicConfig } from "@/config/env.config";

export function convertBaseUnitsToCredits(credits: bigint): number {
  return Number(credits) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export function convertCreditsToBaseUnits(credits: number): bigint {
  return BigInt(credits * 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE);
}
