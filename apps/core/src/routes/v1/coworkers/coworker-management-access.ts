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

async function userCanManageCoworker(
  userId: string,
  coworker: { id: string; vendorId: string },
): Promise<boolean> {
  const [vendorAdminMembership, assignment] = await Promise.all([
    prisma.vendorMember.findFirst({
      where: {
        vendorId: coworker.vendorId,
        userId,
        role: "admin",
      },
      select: { id: true },
    }),
    prisma.coworkerAssignment.findFirst({
      where: {
        coworkerId: coworker.id,
        userId,
      },
      select: { id: true },
    }),
  ]);

  return vendorAdminMembership != null || assignment != null;
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
      vendorId: true,
    },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }

  const canManage = await userCanManageCoworker(
    userAuthContext.userId,
    coworker,
  );

  if (!canManage) {
    throw forbidden("You do not have permission to manage this coworker");
  }

  return userAuthContext;
}
