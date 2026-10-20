import type { Prisma } from "@sokosumi/database";
import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden, notFound } from "@/helpers/error";
import { requireSocialBetaAccess } from "@/helpers/social-beta-access";
import prisma from "@/lib/db/prisma";
import { requireProjectAccess } from "@/lib/image-studio/access";
import {
  type AuthenticationContext,
  type CoworkerAuthenticationContext,
  isSokoBotAuthContext,
  requireInteractiveUserAuthContext,
} from "@/middleware/auth";

import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";
import {
  requireWorkspaceContext,
  type WorkspaceContext,
} from "@/middleware/workspace";

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

/** Research reads use the personal owner's access or a shared bot's own Project. */
export async function requireSocialResearchScope(
  authContext: AuthenticationContext,
  projectId: string,
  workspaceContext: WorkspaceContext | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<{ workspaceId: string }> {
  if (!isSokoBotAuthContext(authContext)) {
    const actor = await requireSocialPostActor(authContext, tx);
    await requireSocialBetaAccess(actor.userId, tx);
    return requireWorkspaceContext(workspaceContext);
  }
  const { workspaceId } = authContext;
  if (authContext.scope === "personal") {
    await requireProjectAccess(
      { projectId, workspaceId, userId: authContext.userId },
      tx,
    );
    await requireSocialBetaAccess(authContext.userId, tx);
  } else {
    if (authContext.scope !== "project" || authContext.projectId !== projectId)
      throw forbidden("This Soko Bot can research only its own Project");
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        workspaceId,
        workspace: {
          organizationId: authContext.organizationId,
          organization: { slug: SOCIAL_BETA_ORGANIZATION_SLUG },
        },
      },
      select: { id: true },
    });
    if (!project) throw notFound("Project not found or Social unavailable");
  }
  return { workspaceId };
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
  await requireSocialBetaAccess(actor.userId, prisma);
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
