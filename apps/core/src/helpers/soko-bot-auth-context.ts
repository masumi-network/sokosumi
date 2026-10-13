import type { Prisma } from "@sokosumi/database";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import type {
  PersonalSokoBotAuthenticationContext,
  SharedSokoBotAuthenticationContext,
  SokoBotAuthenticationContext,
} from "@/middleware/auth";
import {
  type ActiveUserCandidate,
  isActiveUser,
} from "@/middleware/auth-active-user";

/**
 * The bot columns a Soko Bot key resolves through. `userId` and `projectId`
 * are nullable here ahead of the schema: a shared bot has no owner.
 */
export interface SokoBotKeyHolder {
  archivedAt: Date | null;
  deletedAt: Date | null;
  userId: string | null;
  projectId: string | null;
  workspaceId: string;
  user: ActiveUserCandidate | null;
}

export interface SokoBotKeyWorkspace {
  organizationId: string | null;
}

/** The context a personal bot acts in: its owner, in this workspace. */
export function personalSokoBotAuthContext(
  bot: { sokoBotId: string; userId: string },
  workspace: { id: string; organizationId: string | null },
): PersonalSokoBotAuthenticationContext {
  return {
    actor: "sokoBot",
    scope: "personal",
    sokoBotId: bot.sokoBotId,
    userId: bot.userId,
    workspaceId: workspace.id,
    organizationId: workspace.organizationId,
  };
}

/** The context a shared bot acts in: itself, in its Organization workspace. */
export function sharedSokoBotAuthContext(
  bot: { sokoBotId: string; projectId: string | null },
  workspace: { id: string; organizationId: string },
): SharedSokoBotAuthenticationContext {
  return {
    actor: "sokoBot",
    scope: bot.projectId === null ? "workspace" : "project",
    sokoBotId: bot.sokoBotId,
    userId: null,
    workspaceId: workspace.id,
    organizationId: workspace.organizationId,
    projectId: bot.projectId,
  };
}

function isLiveKeyHolder(bot: SokoBotKeyHolder): boolean {
  if (bot.archivedAt || bot.deletedAt) {
    return false;
  }
  // Banning the owner does not revoke a personal bot's key, and the bot acts
  // as that owner, so the ban has to be read here.
  return bot.userId === null || isActiveUser(bot.user);
}

/**
 * The workspace a key may still act in, or `null` when the bot cannot
 * authenticate at all and no lookup is needed.
 *
 * Personal: the owner must still reach the workspace (membership is read live,
 * since leaving an organization revokes nothing on the key). Shared: the bot
 * is its own principal, so only an Organization workspace qualifies.
 */
export function sokoBotKeyWorkspaceWhere(
  bot: SokoBotKeyHolder,
): Prisma.WorkspaceWhereInput | null {
  if (!isLiveKeyHolder(bot)) {
    return null;
  }
  if (bot.userId !== null) {
    return sokoBotWorkspaceAccessWhere(bot.userId, bot.workspaceId);
  }
  return { id: bot.workspaceId, organizationId: { not: null } };
}

/**
 * Builds the auth context for a Soko Bot key from its bot row and the result
 * of the {@link sokoBotKeyWorkspaceWhere} lookup, or `null` when the key must
 * not authenticate.
 */
export function buildSokoBotKeyAuthContext(
  sokoBotId: string,
  bot: SokoBotKeyHolder,
  workspace: SokoBotKeyWorkspace | null,
): SokoBotAuthenticationContext | null {
  if (!isLiveKeyHolder(bot) || !workspace) {
    return null;
  }

  if (bot.userId !== null) {
    return personalSokoBotAuthContext(
      { sokoBotId, userId: bot.userId },
      { id: bot.workspaceId, organizationId: workspace.organizationId },
    );
  }

  if (workspace.organizationId === null) {
    return null;
  }

  return sharedSokoBotAuthContext(
    { sokoBotId, projectId: bot.projectId },
    { id: bot.workspaceId, organizationId: workspace.organizationId },
  );
}
