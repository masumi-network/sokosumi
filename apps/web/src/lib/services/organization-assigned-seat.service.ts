import "server-only";

import { coreClient } from "@/lib/clients/core.client";

export async function hasAssignedOrganizationSeat(
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) {
    return true;
  }

  const { data } = await coreClient.getOrganizationCallerSeat(organizationId);
  return data.assigned;
}
