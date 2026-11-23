import { waitUntil } from "@vercel/functions";

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
import { emitCoreError } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import type {
  CoworkerAuthenticationContext,
  SokoBotAuthenticationContext,
} from "@/middleware/auth";
import { BEARER_USER_SELECT } from "@/middleware/auth-active-user";

const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Records a successful authentication on the key, at most once a minute, so
 * one busy agent does not turn every request into a write. Runs after the
 * response; a failed write only loses the timestamp.
 */
function recordAgentApiKeyUse(
  key: { id: string; lastUsedAt: Date | null },
  now: Date,
) {
  const staleBefore = new Date(now.getTime() - LAST_USED_WRITE_INTERVAL_MS);
  if (key.lastUsedAt && key.lastUsedAt > staleBefore) {
    return;
  }

  waitUntil(
    // Started inside `then`, so even a synchronous throw becomes a logged
    // rejection and never fails the request it authenticates.
    Promise.resolve()
      .then(() =>
        prisma.coworkerApiKey.updateMany({
          // Concurrent requests that all read a stale value write once.
          where: {
            id: key.id,
            OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: staleBefore } }],
          },
          data: { lastUsedAt: now },
        }),
      )
      .then(
        () => undefined,
        (error: unknown) => {
          // Standalone: this may settle while the request's own event is live.
          emitCoreError(
            { operation: "agent_api_key_last_used", id: key.id },
            {
              message: "Could not record when an agent API key was last used",
              why: "The lastUsedAt update on coworker_api_key failed",
              fix: "Check database health; the request itself was served.",
            },
            { failure: messageSafeErrorFields(error) },
          );
        },
      ),
  );
}

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
      id: true,
      lastUsedAt: true,
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

  const now = new Date();
  if (apiKey.expiresAt && apiKey.expiresAt <= now) {
    return null;
  }

  if (apiKey.coworkerId && apiKey.coworker) {
    if (apiKey.coworker.archivedAt) {
      return null;
    }

    recordAgentApiKeyUse(apiKey, now);
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

    const context = buildSokoBotKeyAuthContext(
      apiKey.sokoBotId,
      apiKey.sokoBot,
      workspace,
    );
    if (context) {
      recordAgentApiKeyUse(apiKey, now);
    }
    return context;
  }

  return null;
}
