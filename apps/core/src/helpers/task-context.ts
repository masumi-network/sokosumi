import type { Prisma } from "@sokosumi/database";

import type { UserAuthenticationContext } from "@/middleware/auth";

export function buildCurrentUserTaskContextWhere(
  authContext: UserAuthenticationContext,
): Prisma.TaskWhereInput {
  return {
    userId: authContext.userId,
    organizationId: authContext.organizationId,
  };
}
