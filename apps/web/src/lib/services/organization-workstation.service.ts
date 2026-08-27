import "server-only";

import { coreClient } from "@/lib/clients/core.client";

export async function canUseOrganizationWorkstation(
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) {
    return true;
  }

  const { data } = await coreClient.getOrganizationWorkstation(organizationId);
  return data.canUse;
}
