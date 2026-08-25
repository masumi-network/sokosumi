import { workspaceRepository } from "@sokosumi/database/repositories";

import { requireDriveStoreMatchesActiveWorkspace } from "@/helpers/drive-file-access";
import { badRequest, forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import type { UserContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

interface ResolveDriveTasksWorkspaceInput {
  userContext: UserContext;
  scope: "me" | "org";
  organizationId?: string;
}

interface ResolvedWorkspace {
  id: string;
  userId: string | null;
  organizationId: string | null;
}

function toWorkspaceContext(workspace: ResolvedWorkspace): WorkspaceContext {
  return {
    workspaceId: workspace.id,
    userId: workspace.userId,
    organizationId: workspace.organizationId,
  };
}

/**
 * Bind the requested Drive store to the active workspace, then resolve that
 * workspace. Level 3 list and copy pass the result to `requireTaskReadForRouteVars`.
 */
export async function resolveDriveTasksWorkspace(
  input: ResolveDriveTasksWorkspaceInput,
): Promise<WorkspaceContext> {
  const { userContext, scope, organizationId } = input;
  const userId = userContext.userId;

  if (scope === "me") {
    requireDriveStoreMatchesActiveWorkspace(userContext, "user", userId);
    const workspace = await workspaceRepository.resolveWorkspaceForContext(
      userId,
      null,
      prisma,
    );
    return toWorkspaceContext(workspace);
  }

  if (!organizationId) {
    throw badRequest("organizationId is required when scope=org");
  }

  requireDriveStoreMatchesActiveWorkspace(
    userContext,
    "organization",
    organizationId,
  );

  const member = await prisma.member.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
  });
  if (!member) {
    throw forbidden("Not a member of this organization");
  }

  const workspace = await workspaceRepository.resolveWorkspaceForContext(
    userId,
    organizationId,
    prisma,
  );
  return toWorkspaceContext(workspace);
}
