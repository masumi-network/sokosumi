import type { ProjectSocialConnection } from "@sokosumi/database";
import { z } from "zod";

import { deleteComposioToolSession } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";
import prisma from "@/lib/db/prisma";
import { projectExecutorUserId } from "@/services/project-social-connections.service";

export const X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 3_000;

type XConnection = Pick<
  ProjectSocialConnection,
  | "id"
  | "projectId"
  | "provider"
  | "composioConnectedAccountId"
  | "subscriptionType"
>;

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
  { signal }: { signal?: AbortSignal } = {},
): Promise<string | null> {
  if (connection.provider !== "x") return connection.subscriptionType;
  const timeout = AbortSignal.timeout(X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS);
  const lookupSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const subscriptionType = await lookupXSubscriptionType(
    connection,
    lookupSignal,
  );
  if (subscriptionType === null) return connection.subscriptionType;
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
    }
  }
  return subscriptionType;
}

/** Lookups per listing; later accounts keep their stored tier. */
export const X_SUBSCRIPTION_LOOKUP_MAX_ACCOUNTS = 5;

/**
 * Current tiers of a Project's active X accounts, keyed by connection id, for
 * callers that must state each account's text limit. Lookups run in parallel
 * under the per-lookup timeout and fall back to the stored tier.
 */
export async function resolveProjectXSubscriptionTypes(
  projectId: string,
): Promise<Map<string, string | null>> {
  const connections = await prisma.projectSocialConnection.findMany({
    where: { projectId, provider: "x", status: "active" },
    select: {
      id: true,
      projectId: true,
      provider: true,
      composioConnectedAccountId: true,
      subscriptionType: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: X_SUBSCRIPTION_LOOKUP_MAX_ACCOUNTS,
  });
  const tiers = await Promise.all(
    connections.map((connection) => resolveXSubscriptionType(connection)),
  );
  return new Map(
    connections.map((connection, index) => [connection.id, tiers[index]]),
  );
}
