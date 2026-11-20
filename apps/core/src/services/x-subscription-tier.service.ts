import type { ProjectSocialConnection } from "@sokosumi/database";
import { z } from "zod";

import { deleteComposioToolSession } from "@/clients/composio.client";
import {
  createComposioToolSession,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";
import prisma from "@/lib/db/prisma";
import { EVAL_CONNECTED_ACCOUNT_PREFIX } from "@/lib/evals/eval-guard";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { connectionExecutorUserId } from "@/services/project-social-connections.service";

export const X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS = 3_000;

type XConnection = Pick<
  ProjectSocialConnection,
  | "id"
  | "projectId"
  | "provider"
  | "composioConnectedAccountId"
  | "subscriptionType"
> & { executorProjectId?: string | null };

const subscriptionSchema = z.enum(["None", "Basic", "Premium", "PremiumPlus"]);

const FALLBACK_FIX =
  "Nothing to do for one miss: posting uses the stored tier and the next post checks again. If it repeats, check the account's X connection in Composio.";

// A route and the publisher's background work both resolve tiers.
const LOG_CONTEXT = { operation: "x_subscription_tier" };

async function lookupXSubscriptionType(
  connection: XConnection,
  signal: AbortSignal,
  timeout: AbortSignal,
): Promise<string | null> {
  let sessionId: string | undefined;
  try {
    sessionId = await createComposioToolSession({
      toolkitSlug: "twitter",
      connectedAccountId: connection.composioConnectedAccountId,
      executorUserId: connectionExecutorUserId(connection),
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
    // One request can look up several accounts: each warning keeps its own.
    recordCoreWarning(LOG_CONTEXT, {
      message: "Could not read an X account's subscription tier",
      why: "X's account lookup returned no known subscription tier",
      fix: FALLBACK_FIX,
      details: { connection: { id: connection.id } },
    });
    return null;
  } catch (error) {
    // Composio's error can quote X's response: only its shape is logged.
    recordCoreWarning(LOG_CONTEXT, {
      message: "Could not read an X account's subscription tier",
      // The combined signal keeps the reason of whichever aborted first.
      why: !signal.aborted
        ? "X's account lookup failed"
        : signal.reason === timeout.reason
          ? `X's account lookup did not answer within ${X_SUBSCRIPTION_LOOKUP_TIMEOUT_MS / 1000} seconds`
          : "The caller stopped the lookup before X answered",
      fix: FALLBACK_FIX,
      details: {
        connection: { id: connection.id },
        aborted: signal.aborted,
        failure: messageSafeErrorFields(error),
      },
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
    timeout,
  );
  if (subscriptionType === null) return connection.subscriptionType;
  if (subscriptionType !== connection.subscriptionType) {
    try {
      await prisma.projectSocialConnection.update({
        where: { id: connection.id },
        data: { subscriptionType },
      });
    } catch (error) {
      recordCoreWarning(LOG_CONTEXT, {
        message: "Could not store an X account's subscription tier",
        why: "Updating the social connection failed",
        fix: "Nothing to do for one miss: this post uses the fresh tier and the next one looks it up again. If it repeats, read the error under warnings[].cause.",
        cause: error,
        details: { connection: { id: connection.id } },
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
    where: {
      projectId,
      provider: "x",
      status: "active",
      // The eval world's stand-in accounts have no Composio account to read.
      composioConnectedAccountId: {
        not: { startsWith: EVAL_CONNECTED_ACCOUNT_PREFIX },
      },
    },
    select: {
      id: true,
      projectId: true,
      provider: true,
      composioConnectedAccountId: true,
      executorProjectId: true,
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
