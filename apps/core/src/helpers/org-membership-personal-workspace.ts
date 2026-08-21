import type { Prisma } from "@sokosumi/database";
import { workspaceRepository } from "@sokosumi/database/repositories";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";

interface EnsurePersonalWorkspaceForOrganizationMembershipOptions {
  tx?: Prisma.TransactionClient;
  organizationId?: string;
}

/**
 * Temporary overlay (ADR 0010). No-op unless REQUIRE_PERSONAL_WORKSPACE is
 * true. Does not clear preferredOrganizationId. When this call creates the
 * personal workspace and preferred is unset, pins preferred to organizationId
 * so session create does not drop the user into personal.
 */
export async function ensurePersonalWorkspaceForOrganizationMembership(
  userId: string,
  options: EnsurePersonalWorkspaceForOrganizationMembershipOptions = {},
): Promise<void> {
  if (!getEnv().REQUIRE_PERSONAL_WORKSPACE) {
    return;
  }

  const { organizationId } = options;

  if (options.tx) {
    await ensureOnTransaction(userId, options.tx, organizationId);
    return;
  }

  await prisma.$transaction(async (innerTx) => {
    await ensureOnTransaction(userId, innerTx, organizationId);
  });
}

async function ensureOnTransaction(
  userId: string,
  tx: Prisma.TransactionClient,
  organizationId: string | undefined,
): Promise<void> {
  const result =
    await workspaceRepository.ensurePersonalWorkspaceKeepingPreferred({
      userId,
      tx,
    });

  if (!organizationId || !result.created) {
    return;
  }

  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { preferredOrganizationId: true },
  });
  if (user?.preferredOrganizationId) {
    return;
  }

  await tx.user.update({
    where: { id: userId },
    data: { preferredOrganizationId: organizationId },
  });
}

/**
 * Org-create runs personal ensure in `beforeCreateOrganization` (no org id
 * yet). Pin afterwards so session create does not drop the creator into
 * personal. No-op when preferred is already set.
 */
export async function pinPreferredOrganizationIfUnset(
  userId: string,
  organizationId: string,
): Promise<void> {
  if (!getEnv().REQUIRE_PERSONAL_WORKSPACE) {
    return;
  }

  await prisma.user.updateMany({
    where: { id: userId, preferredOrganizationId: null },
    data: { preferredOrganizationId: organizationId },
  });
}
