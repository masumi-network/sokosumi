import type { Prisma, Workspace } from "@sokosumi/database";
import {
  isPersonalWorkspaceMissingError,
  workspaceRepository,
} from "@sokosumi/database/repositories";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { badRequest, notFound } from "@/helpers/error";

function rethrowPersonalWorkspaceMissing(error: unknown): never {
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

/**
 * {@link resolveWorkspaceForContextOrNotFound} for a coworker acting as a
 * user. Without an organization the context is the personal workspace, so a
 * user who has only organization workspaces must be given one: 400.
 */
export async function resolveCoworkerContextWorkspace(
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
    if (isPersonalWorkspaceMissingError(error)) {
      throw badRequest(
        "An organization is required: the context user has no personal workspace",
        { kind: CORE_API_ERROR_KINDS.CONTEXT_ORGANIZATION_REQUIRED },
      );
    }
    throw error;
  }
}
