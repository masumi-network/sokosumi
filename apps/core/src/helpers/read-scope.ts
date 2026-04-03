import type { Prisma } from "@sokosumi/database";
import { resolveWorkspaceForContext } from "@sokosumi/database/helpers";

import prisma from "@/lib/db/prisma";
import type { UserAuthenticationContext } from "@/middleware/auth";

export interface UserReadScope {
  workspaceId: string;
  ownerUserId: string | null;
  organizationId: string | null;
}

export async function resolveUserReadScope(
  authContext: UserAuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<UserReadScope> {
  const workspace = await resolveWorkspaceForContext(
    authContext.userId,
    authContext.organizationId,
    tx,
  );

  return {
    workspaceId: workspace.id,
    ownerUserId: authContext.organizationId ? null : authContext.userId,
    organizationId: authContext.organizationId,
  };
}

export function buildScopedReadWhere(
  scope: UserReadScope,
  memberId?: string,
): {
  workspaceId: string;
  userId?: string;
} {
  return {
    workspaceId: scope.workspaceId,
    ...(scope.ownerUserId
      ? {
          userId: scope.ownerUserId,
        }
      : memberId
        ? {
            userId: memberId,
          }
        : {}),
  };
}
