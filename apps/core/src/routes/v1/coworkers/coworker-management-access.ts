import { forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  hasAdminRole,
  requireUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

interface CoworkerMutationWhere {
  id: string;
  archivedAt?: null;
}

export function buildCoworkerMutationWhere(
  id: string,
  allowArchived: boolean,
): CoworkerMutationWhere {
  return allowArchived ? { id } : { id, archivedAt: null };
}

export async function requireCoworkerManagementAccess(
  authContext: AuthenticationContext,
  coworkerId: string,
): Promise<UserAuthenticationContext> {
  const userAuthContext = requireUserAuthContext(authContext);

  if (hasAdminRole(userAuthContext.role)) {
    return userAuthContext;
  }

  const coworker = await prisma.coworker.findFirst({
    where: {
      id: coworkerId,
      archivedAt: null,
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }

  if (coworker.userId !== userAuthContext.userId) {
    throw forbidden("You can only manage your own coworkers");
  }

  return userAuthContext;
}
