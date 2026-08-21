import type { Prisma } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

/**
 * Temporary overlay (ADR 0010). No-op unless REQUIRE_PERSONAL_WORKSPACE is
 * true. Does not clear preferredOrganizationId.
 */
export async function ensurePersonalWorkspaceForOrganizationMembership(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (!getEnv().REQUIRE_PERSONAL_WORKSPACE) {
    return;
  }

  if (tx) {
    await workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
      userId,
      tx,
    });
    return;
  }

  await prisma.$transaction(async (innerTx) => {
    await workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
      userId,
      tx: innerTx,
    });
  });
}
