import "server-only";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { organizationSeatService } from "@/lib/services/organization-seat.service";

export async function isOrganizationProductLocked(): Promise<boolean> {
  const session = await getSessionOrRedirect();
  const organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    return false;
  }

  return !(await organizationSeatService.hasAssignedSeat(organizationId));
}
