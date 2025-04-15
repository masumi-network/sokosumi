import { getEnvPublicConfig } from "@/config/env.config";

export function convertCreditsToHumanReadableCredits(credits: bigint): number {
  return Number(credits) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export function convertHumanReadableCreditsToCredits(
  humanReadableCredits: number,
): bigint {
  return BigInt(
    humanReadableCredits * 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE,
  );
}
