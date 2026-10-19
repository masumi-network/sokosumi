import type { Prisma } from "@sokosumi/database";

import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";

/**
 * The Seat check before charging work (ADR 0020, ADR 0057): it runs on the
 * work's Owner. Work without an Owner is charged to the Organization pool
 * with no member, so there is no Seat to check.
 */
export async function requireOwnerSeat(
  ownerId: string | null,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (ownerId === null) {
    return;
  }
  await requireAssignedOrganizationSeat(ownerId, organizationId, tx);
}
