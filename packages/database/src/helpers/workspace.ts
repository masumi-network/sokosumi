import type { Prisma } from "../generated/prisma/client.js";
import { workspaceRepository } from "../repositories/workspace.repository.js";

export async function resolveWorkspaceForContext(
  userId: string,
  organizationId: string | null | undefined,
  tx: Prisma.TransactionClient,
) {
  if (organizationId) {
    return await workspaceRepository.upsertOrganizationWorkspace(
      organizationId,
      tx,
    );
  } else {
    return await workspaceRepository.upsertPersonalWorkspace(userId, tx);
  }
}
