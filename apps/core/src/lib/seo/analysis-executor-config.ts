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

/** The configured SEO worker, and for a scoped executor only inside its own Task context. */
export function isConfiguredSeoExecutor(
  coworker: { coworkerId: string; context?: unknown },
  context: {
    ownerId: string;
    organizationId: string | null;
    workspaceId: string;
  },
) {
  const { executor } = getSeoAnalysisExecution();
  return (
    !coworker.context &&
    !!executor &&
    executor.coworkerId === coworker.coworkerId &&
    ("mode" in executor ||
      (executor.workspaceId === context.workspaceId &&
        executor.ownerId === context.ownerId &&
        executor.organizationId === context.organizationId))
  );
}

/**
 * The configured global SEO worker on a direct call. A scoped executor serves
 * one customer's Tasks only, so it never reads work across customers.
 */
export function isGlobalSeoExecutor(coworker: {
  coworkerId: string;
  context?: unknown;
}) {
  const { executor } = getSeoAnalysisExecution();
  return (
    !coworker.context &&
    !!executor &&
    "mode" in executor &&
    executor.coworkerId === coworker.coworkerId
  );
}
