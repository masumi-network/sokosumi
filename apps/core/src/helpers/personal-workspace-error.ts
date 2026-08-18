import type { Prisma, Workspace } from "@sokosumi/database";
import {
  isPersonalWorkspaceMissingError,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { notFound } from "@/helpers/error";

export function rethrowPersonalWorkspaceMissing(error: unknown): never {
  if (isPersonalWorkspaceMissingError(error)) {
    throw notFound("Personal workspace is missing", {
      kind: CORE_API_ERROR_KINDS.PERSONAL_WORKSPACE_MISSING,
    });
  }

  throw error;
}

export async function resolveWorkspaceForContextOrNotFound(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient,
): Promise<Workspace> {
  try {
    return await workspaceRepository.resolveWorkspaceForContext(
      userId,
      organizationId,
      tx,
    );
  } catch (error) {
    rethrowPersonalWorkspaceMissing(error);
  }
}
