import { forbidden } from "@/helpers/error";
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

export async function requireCoworkerAdminAuthContext(
  authContext: AuthenticationContext,
): Promise<UserAuthenticationContext> {
  const userAuthContext = requireUserAuthContext(authContext);

  const user = await prisma.user.findUnique({
    where: {
      id: userAuthContext.userId,
    },
    select: {
      role: true,
    },
  });

  if (!hasAdminRole(user?.role)) {
    throw forbidden("Admin access required");
  }

  return userAuthContext;
}
