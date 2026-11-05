import { getEnv } from "@/config/env";
import { conflict } from "@/helpers/error";

export function isSeoAnalysisDispatchEnabled(): boolean {
  return getEnv().SEO_ANALYSIS_DISPATCH_ENABLED === true;
}

/** Old workers treat a packet's first URL as a full audit and ignore its bounds. */
export function requireSeoAnalysisDispatch(): void {
  if (!isSeoAnalysisDispatchEnabled())
    throw conflict(
      "SEO analysis dispatch is disabled until the compatible public worker rollout is verified",
    );
}
