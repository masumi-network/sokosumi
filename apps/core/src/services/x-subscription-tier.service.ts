import type { ProjectSocialConnection } from "@sokosumi/database";
import { z } from "zod";

import { deleteComposioToolSession } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";
import prisma from "@/lib/db/prisma";
import { projectExecutorUserId } from "@/services/project-social-connections.service";

export const X_SUBSCRIPTION_CACHE_TTL_MS = 60_000;
export const X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 3_000;

type XConnection = Pick<
  ProjectSocialConnection,
  | "id"
  | "projectId"
  | "provider"
  | "composioConnectedAccountId"
  | "subscriptionType"
>;

interface CachedTier {
  subscriptionType: string;
  expiresAt: number;
}

/** Separate instances keep successful lookups and in-flight requests isolated in tests. */
export function createXSubscriptionTierCache() {
  return {
    successful: new Map<string, CachedTier>(),
    inFlight: new Map<string, Promise<string | null>>(),
  };
}

const defaultCache = createXSubscriptionTierCache();
const subscriptionSchema = z.enum(["None", "Basic", "Premium", "PremiumPlus"]);

async function lookupXSubscriptionType(
  connection: XConnection,
  signal: AbortSignal,
): Promise<string | null> {
  let sessionId: string | undefined;
  try {
    sessionId = await createComposioToolSession({
      toolkitSlug: "twitter",
      connectedAccountId: connection.composioConnectedAccountId,
      executorUserId: projectExecutorUserId(connection.projectId),
      toolSlugs: ["TWITTER_USER_LOOKUP_ME"],
      context: "create X subscription lookup session",
      signal,
    });
    const payload = await executeComposioTool({
      sessionId,
      toolSlug: "TWITTER_USER_LOOKUP_ME",
      arguments: { user_fields: ["subscription_type"] },
      context: "read X subscription tier",
      refused: "X subscription tier is unavailable",
      signal,
    });
    const parsed = subscriptionSchema.safeParse(payload?.subscription_type);
    if (parsed.success) return parsed.data;
    console.warn("[x-subscription-tier] Invalid subscription response", {
      connectionId: connection.id,
    });
    return null;
  } catch {
    console.warn("[x-subscription-tier] Subscription lookup failed", {
      connectionId: connection.id,
      aborted: signal.aborted,
    });
    return null;
  } finally {
    if (sessionId) {
      await deleteComposioToolSession(
        sessionId,
        "delete X subscription lookup session",
        signal,
      );
    }
  }
}

/** Lookup failures preserve the last known tier and never prevent posting. */
export async function resolveXSubscriptionType(
  connection: XConnection,
  {
    cache = defaultCache,
    refresh = false,
    signal,
  }: {
    cache?: ReturnType<typeof createXSubscriptionTierCache>;
    /** Publishing rechecks even when the composer or save just populated the cache. */
    refresh?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<string | null> {
  if (connection.provider !== "x") return connection.subscriptionType;
  const now = Date.now();
  // Prune expired entries so idle connections do not accumulate for the process lifetime.
  for (const [id, entry] of cache.successful) {
    if (entry.expiresAt <= now) cache.successful.delete(id);
  }
  const cached = refresh ? undefined : cache.successful.get(connection.id);
  let subscriptionType = cached?.subscriptionType;
  if (subscriptionType === undefined) {
    let request = cache.inFlight.get(connection.id);
    if (!request) {
      const timeout = AbortSignal.timeout(X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
      const lookupSignal = signal
        ? AbortSignal.any([signal, timeout])
        : timeout;
      request = lookupXSubscriptionType(connection, lookupSignal).then(
        (tier) => {
          if (tier !== null) {
            cache.successful.set(connection.id, {
              subscriptionType: tier,
              expiresAt: Date.now() + X_SUBSCRIPTION_CACHE_TTL_MS,
            });
          }
          return tier;
        },
      );
      cache.inFlight.set(connection.id, request);
      const activeRequest = request;
      void request.finally(() => {
        if (cache.inFlight.get(connection.id) === activeRequest) {
          cache.inFlight.delete(connection.id);
        }
      });
    }
    const resolved = await request;
    if (resolved === null) return connection.subscriptionType;
    subscriptionType = resolved;
  }
  if (subscriptionType !== connection.subscriptionType) {
    try {
      await prisma.projectSocialConnection.update({
        where: { id: connection.id },
        data: { subscriptionType },
      });
    } catch {
      console.warn("[x-subscription-tier] Could not store subscription tier", {
        connectionId: connection.id,
      });
      return connection.subscriptionType;
    }
  }
  return subscriptionType;
}
