import "server-only";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { hasAssignedOrganizationSeat } from "@/lib/services/organization-assigned-seat.service";

export async function isOrganizationProductLocked(): Promise<boolean> {
  const session = await getSessionOrRedirect();
  const organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    return false;
  }

  return !(await hasAssignedOrganizationSeat(organizationId));
}
