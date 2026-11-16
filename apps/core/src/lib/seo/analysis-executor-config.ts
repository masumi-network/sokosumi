import { getEnv } from "@/config/env";

// The reviewed first-party Mainnet service. Rotating its key keeps this identity.
const MAINNET_SEO_COWORKER_ID = "1d7aeb62-1f65-4c5a-b4d3-f80faa08e80f";
const MAINNET_SEO_EXECUTOR = Object.freeze({
  mode: "global" as const,
  coworkerId: MAINNET_SEO_COWORKER_ID,
  canUsePaidSearchData: true,
  canSchedule: true,
});

/** Selection and start authorization must recognize the same service, even while its Tasks capability is paused. */
export function getSeoAnalysisExecution() {
  const env = getEnv();
  // Preview databases must not enqueue work to a worker polling canonical Mainnet.
  const liveMainnet =
    env.NETWORK === "Mainnet" && env.VERCEL_ENV === "production";
  const useMainnetDefault = liveMainnet && !env.SEO_ANALYSIS_EXECUTOR;
  return {
    enabled:
      env.SEO_ANALYSIS_DISPATCH_ENABLED === true ||
      (useMainnetDefault &&
        process.env.SEO_ANALYSIS_DISPATCH_ENABLED === undefined),
    executor:
      env.SEO_ANALYSIS_EXECUTOR ??
      (liveMainnet ? MAINNET_SEO_EXECUTOR : undefined),
  };
}
