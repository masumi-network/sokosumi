import "server-only";

import { coreClient } from "@/lib/clients/core.client";

export async function canUseOrganizationWorkstation(
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) {
    return true;
  }

  const [billingPlan, member] = await Promise.all([
    coreClient.getOrganizationBillingPlan(organizationId),
    coreClient.getMyMemberInOrganization(organizationId),
  ]);

  if (
    billingPlan.data.mode === "self_serve" &&
    billingPlan.data.plan === "free"
  ) {
    return true;
  }

  return member?.data.seatAssignedAt != null;
}
