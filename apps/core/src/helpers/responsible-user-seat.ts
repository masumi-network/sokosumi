import type { Prisma } from "@sokosumi/database";

import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";

/**
 * The Seat check before charging work (ADR 0020, ADR 0056): it runs on the
 * work's responsible person. Work nobody is responsible for is charged to the
 * Organization pool with no member, so there is no Seat to check.
 */
export async function requireResponsibleUserSeat(
  responsibleUserId: string | null,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (responsibleUserId === null) {
    return;
  }
  await requireAssignedOrganizationSeat(responsibleUserId, organizationId, tx);
}
