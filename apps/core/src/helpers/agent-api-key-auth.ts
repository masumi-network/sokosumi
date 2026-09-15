import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import {
  COWORKER_API_KEY_PREFIX,
  hashApiKey,
  isSokoBotApiKeyToken,
} from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import type {
  CoworkerAuthenticationContext,
  SokoBotAuthenticationContext,
} from "@/middleware/auth";
import {
  BEARER_USER_SELECT,
  isActiveUser,
} from "@/middleware/auth-active-user";

/**
 * Resolves a dedicated agent API key to the context it may act in, or `null`
 * when the key must not authenticate.
 *
 * Resolution only, so the middleware stays the single place that writes the
 * request's auth context and this module needs no runtime import from it.
 */
export async function resolveAgentApiKeyAuthContext(
  token: string,
): Promise<
  CoworkerAuthenticationContext | SokoBotAuthenticationContext | null
> {
  if (
    !token.startsWith(COWORKER_API_KEY_PREFIX) &&
    !isSokoBotApiKeyToken(token)
  ) {
    return null;
  }

  const keyHash = await hashApiKey(token);
  const apiKey = await prisma.coworkerApiKey.findUnique({
    where: {
      keyHash,
    },
    select: {
      coworkerId: true,
      sokoBotId: true,
      revokedAt: true,
      expiresAt: true,
      coworker: {
        select: {
          archivedAt: true,
          vendorId: true,
        },
      },
      sokoBot: {
        select: {
          archivedAt: true,
          deletedAt: true,
          userId: true,
          workspaceId: true,
          user: { select: BEARER_USER_SELECT },
        },
      },
    },
  });

  if (!apiKey) {
    return null;
  }

  if (apiKey.revokedAt) {
    return null;
  }

  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
    return null;
  }

  if (apiKey.coworkerId && apiKey.coworker) {
    if (apiKey.coworker.archivedAt) {
      return null;
    }

    return {
      actor: "coworker",
      coworkerId: apiKey.coworkerId,
      vendorId: apiKey.coworker.vendorId,
    };
  }

  if (
    apiKey.sokoBotId &&
    apiKey.sokoBot &&
    !apiKey.sokoBot.archivedAt &&
    !apiKey.sokoBot.deletedAt
  ) {
    // Banning the owner does not revoke the bot key. requireUserContext then
    // maps this actor to that owner, so the check has to live here.
    if (!isActiveUser(apiKey.sokoBot.user)) {
      return null;
    }

    // Leaving the organization does not revoke the bot key either, and the key
    // carries its own workspace and organization context, so a route that
    // trusts that context alone would still serve the bot. Reading the owner's
    // access here denies every direct-key route at once.
    //
    // This costs one query per bot-key request, where the organization id used
    // to ride along on the key lookup. Membership has to be read live, so the
    // join cannot answer it: the key and its stored context both survive the
    // exit unchanged.
    const workspace = await prisma.workspace.findFirst({
      where: sokoBotWorkspaceAccessWhere(
        apiKey.sokoBot.userId,
        apiKey.sokoBot.workspaceId,
      ),
      select: { organizationId: true },
    });
    if (!workspace) {
      return null;
    }

    return {
      actor: "sokoBot",
      sokoBotId: apiKey.sokoBotId,
      userId: apiKey.sokoBot.userId,
      workspaceId: apiKey.sokoBot.workspaceId,
      organizationId: workspace.organizationId,
    };
  }

  return null;
}
