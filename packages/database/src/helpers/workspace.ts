import type { Prisma } from "../generated/prisma/client.js";
import { workspaceRepository } from "../repositories/workspace.repository.js";

export async function findWorkspaceForContext(
  userId: string,
  organizationId: string | null | undefined,
  tx: Prisma.TransactionClient,
) {
  return await workspaceRepository.findWorkspaceForContext(
    userId,
    organizationId ?? null,
    tx,
  );
}

export async function resolveWorkspaceForContext(
  userId: string,
  organizationId: string | null | undefined,
  tx: Prisma.TransactionClient,
) {
  return await workspaceRepository.upsertWorkspaceForContext(
    userId,
    organizationId ?? null,
    tx,
  );
}
