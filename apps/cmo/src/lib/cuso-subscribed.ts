import type { CmoOverview } from "@sokosumi/core-client";

/**
 * Whether ending this Cuso also ends a subscription: Start over says so
 * before the person confirms.
 */
export function cusoSubscribed(overview: Pick<CmoOverview, "billing">) {
  return overview.billing.status !== null;
}
