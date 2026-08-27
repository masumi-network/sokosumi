import type { Prisma } from "@sokosumi/database";
import { canUseOrganizationWorkstation } from "@sokosumi/database/helpers";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export async function requireOrganizationWorkstation(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const allowed = await canUseOrganizationWorkstation(
    userId,
    organizationId,
    tx,
  );
  if (allowed) {
    return;
  }

  throw forbidden(
    "An assigned seat is required to start coworker-paid work in this organization",
    { kind: CORE_API_ERROR_KINDS.ORGANIZATION_SEAT_REQUIRED },
  );
}
