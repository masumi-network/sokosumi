import { forbidden, notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  requireUserAuthContext,
  type UserAuthenticationContext,
} from "@/middleware/auth";

function hasAdminRole(role: string | null | undefined): boolean {
  return (
    role?.split(",").some((value) => value.trim().toLowerCase() === "admin") ??
    false
  );
}

async function getUserRole(userId: string): Promise<string | null | undefined> {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      role: true,
    },
  });

  return user?.role;
}

export async function requireAdminAuthContext(
  authContext: AuthenticationContext,
): Promise<UserAuthenticationContext> {
  const userAuthContext = requireUserAuthContext(authContext);

  if (!hasAdminRole(await getUserRole(userAuthContext.userId))) {
    throw forbidden("Admin access required");
  }

  return userAuthContext;
}

export async function requireCoworkerManagementAccess(
  authContext: AuthenticationContext,
  coworkerId: string,
): Promise<UserAuthenticationContext> {
  const userAuthContext = requireUserAuthContext(authContext);
  const userRole = await getUserRole(userAuthContext.userId);

  if (hasAdminRole(userRole)) {
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
