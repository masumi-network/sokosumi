import type { Prisma } from "@sokosumi/database";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { requireCalendarBetaAccess } from "@/helpers/calendar-beta-access";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  requireInteractiveUserAuthContext,
} from "@/middleware/auth";

import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";

/** Scheduling follows the existing delegated scheduled-task policy; credentials stay human-only. */
export async function requireSocialPostActor(
  authContext: AuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<{
  userId: string;
  coworkerId?: string;
}> {
  if (authContext.actor !== "coworker") {
    return requireInteractiveUserAuthContext(authContext);
  }
  const userContext = await requireAuthorizedUserContext(authContext, tx);
  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);
  return { userId: userContext.userId, coworkerId: authContext.coworkerId };
}

/** A delayed publish must not outlive its delegation, capability, or contextual user's membership. */
export async function requireSocialPostPublishingAccess(
  authContext: CoworkerAuthenticationContext,
  workspaceId: string,
): Promise<void> {
  const actor = await requireSocialPostActor(authContext);
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: BEARER_USER_SELECT,
  });
  if (!isActiveUser(user)) {
    throw forbidden("Social post scheduler is no longer active");
  }
  await requireCalendarBetaAccess(actor.userId, prisma);
  const workspace = await prisma.workspace.findFirst({
    where: {
      id: workspaceId,
      OR: [
        { userId: actor.userId },
        { organization: { members: { some: { userId: actor.userId } } } },
      ],
    },
    select: { id: true },
  });
  if (!workspace)
    throw forbidden("Social post scheduler no longer belongs to the workspace");
}
