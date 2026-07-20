import type { HermesInstanceStatus } from "@/lib/hermes/types";

export type HermesUiState =
  | "loading"
  | "idle"
  | "provisioning"
  | "infrastructure_ready"
  | "onboarding"
  | "running"
  | "error";

/**
 * Setup-phase clocks must survive `error` / `loading` so Retry after a
 * client-side provision timeout does not write a fresh start and grant
 * another 15 minutes on the same stuck attempt. Clear only when leaving
 * for a real phase change (ready / wizard / idle / …).
 */
export function shouldClearSetupPhaseClock(uiState: HermesUiState): boolean {
  return uiState !== "loading" && uiState !== "error";
}

/** True when ErrorState should offer destroy — orch `error`, or a stuck
 * provision (client timeout leaves status as `provisioning`). */
export function shouldOfferHermesStartOver(options: {
  previewMode: boolean;
  instanceStatus: HermesInstanceStatus | null | undefined;
  isProvisionTimeout: boolean;
}): boolean {
  if (options.previewMode) return false;
  if (options.instanceStatus == null) return false;
  if (options.instanceStatus === "error") return true;
  if (options.instanceStatus === "provisioning") return true;
  return options.isProvisionTimeout;
}
