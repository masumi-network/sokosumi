import type { Prisma } from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

import type { UserAuthenticationContext } from "@/middleware/auth";

import { buildScopedReadWhere, resolveUserReadScope } from "./read-scope";

export async function buildCurrentWorkspaceTaskContextWhere(
  authContext: UserAuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<Prisma.TaskWhereInput> {
  const scope = await resolveUserReadScope(authContext, tx);
  return buildScopedReadWhere(scope);
}
