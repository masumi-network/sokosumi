import type { Prisma } from "@sokosumi/database";
import { resolveWorkspaceForContext } from "@sokosumi/database/helpers";

import prisma from "@/lib/db/prisma";

import type { UserAuthenticationContext } from "@/middleware/auth";

export async function buildCurrentWorkspaceTaskContextWhere(
  authContext: UserAuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<Prisma.TaskWhereInput> {
  const workspace = await resolveWorkspaceForContext(
    authContext.userId,
    authContext.organizationId,
    tx,
  );

  return {
    workspaceId: workspace.id,
  };
}
