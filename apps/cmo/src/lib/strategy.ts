import type { CmoOverview } from "@sokosumi/core-client";

/** Whether the newest strategy version is approved, so Cuso carries it out. */
export function strategyApproved(
  overview: Pick<CmoOverview, "strategyVersion">,
): boolean {
  return overview.strategyVersion?.approvedAt != null;
}
