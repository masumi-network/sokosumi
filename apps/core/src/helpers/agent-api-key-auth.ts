import {
  buildSokoBotKeyAuthContext,
  sokoBotKeyWorkspaceWhere,
} from "@/helpers/soko-bot-auth-context";
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
import { BEARER_USER_SELECT } from "@/middleware/auth-active-user";

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
          projectId: true,
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

  if (apiKey.sokoBotId && apiKey.sokoBot) {
    // Neither leaving the organization nor a ban revokes the key, and the key
    // carries its own workspace context, so a route that trusted that context
    // alone would still serve the bot. Reading access here, live, denies every
    // direct-key route at once.
    const where = sokoBotKeyWorkspaceWhere(apiKey.sokoBot);
    const workspace = where
      ? await prisma.workspace.findFirst({
          where,
          select: { organizationId: true },
        })
      : null;

    return buildSokoBotKeyAuthContext(
      apiKey.sokoBotId,
      apiKey.sokoBot,
      workspace,
    );
  }

  return null;
}
