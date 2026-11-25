import type { Prisma } from "@sokosumi/database";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  requireUserAuthContext,
} from "@/middleware/auth";

import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";

/**
 * Who may draft, schedule and cancel Social posts (ADR 0077): a person on a
 * browser session, or an agent: any other user credential (API key, OAuth or
 * MCP token) or a delegated task-capable Coworker. An agent's write lands as
 * Needs approval. Soko Bots use their own tools.
 */
export async function requireSocialPostActor(
  authContext: AuthenticationContext,
  tx: Prisma.TransactionClient = prisma,
): Promise<SocialPostActor> {
  if (authContext.actor !== "coworker") {
    const user = requireUserAuthContext(authContext);
    return {
      userId: user.userId,
      agent: user.authenticationMethod !== "session",
    };
  }
  const userContext = await requireAuthorizedUserContext(authContext, tx);
  await requireCoworkerCapability(authContext.coworkerId, "tasks", tx);
  return {
    userId: userContext.userId,
    coworkerId: authContext.coworkerId,
    agent: true,
  };
}

export interface SocialPostActor {
  userId: string;
  coworkerId?: string;
  /** No person at the keyboard: the write waits for a person's approval. */
  agent: boolean;
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
