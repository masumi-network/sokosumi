import {
  completeComposioAuth,
  deleteProjectSocialConnectionIntent,
  getComposioConnectedAccount,
  initiateComposioConnection,
} from "@/clients/composio.client";
import { isFirstPartyAppUrl } from "@/config/cors-allow-origin";
import { getWebAppBaseUrl } from "@/config/env";
import { composioHandoffUrl } from "@/helpers/composio-handoff";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import {
  SEO_CONNECTION_PROVIDERS,
  type SeoConnectionProvider,
} from "@/schemas/seo-connection.schema";
import {
  requireComposio,
  withComposio,
} from "@/services/composio-integration-tools.service";
import {
  getSeoConnection,
  requireSeoConnectionOwner,
  type SeoConnectionOwner,
  seoConnectionKey,
} from "@/services/seo-connections.service";

const SEO_CONNECTION_INTENT_TTL_MS = 15 * 60_000;
function entityId(owner: SeoConnectionOwner) {
  return `sokosumi:seo:${owner.workspaceId}:${owner.userId}`;
}
async function authConfig(toolkit: string) {
  const composio = requireComposio();
  const configs = await withComposio("auth config", () =>
    composio.authConfigs.list({ toolkit }),
  );
  const managed = configs.items.find(
    (item) =>
      item.toolkit.slug.toLowerCase() === toolkit && item.isComposioManaged,
  );
  return (
    managed?.id ??
    (
      await withComposio("auth config", () =>
        composio.authConfigs.create(toolkit, {
          type: "use_composio_managed_auth",
          name: `sokosumi-${toolkit}`,
        }),
      )
    ).id
  );
}

export async function connectSeoConnection(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
  callbackUrl?: string,
) {
  await requireSeoConnectionOwner(owner);
  const callback = callbackUrl ?? `${getWebAppBaseUrl()}/composio/callback`;
  const callbackAddress = new URL(callback);
  if (
    !isFirstPartyAppUrl(callback) ||
    !["/composio/callback", "/seo/connections/callback"].includes(
      callbackAddress.pathname,
    ) ||
    callbackAddress.username ||
    callbackAddress.password ||
    callbackAddress.hash
  )
    throw unprocessableEntity("Unknown return address");
  const toolkit = SEO_CONNECTION_PROVIDERS[provider].toolkit;
  const authConfigId = await authConfig(toolkit);
  const identity = entityId(owner);
  const linked = await initiateComposioConnection({
    authConfigId,
    callbackUrl: callback,
    connectorUserId: identity,
    executorUserId: identity,
  });
  let superseded: Array<{ connectionId: string }>;
  try {
    superseded = await serializableTransaction(async (tx) => {
      await requireSeoConnectionOwner(owner, tx);
      const key = seoConnectionKey(owner, provider);
      const selected = await tx.seoConnection.upsert({
        where: { workspaceId_userId_provider: key },
        create: { ...key, revision: 1 },
        update: { revision: { increment: 1 } },
      });
      const previous = await tx.seoConnectionIntent.findMany({
        where: { ...key, finalizedAt: null },
        select: { connectionId: true },
      });
      await tx.seoConnectionIntent.updateMany({
        where: { ...key, finalizedAt: null },
        data: { expiresAt: new Date() },
      });
      await tx.seoConnectionIntent.create({
        data: {
          connectionId: linked.connectionId,
          ...key,
          toolkit,
          authConfigId,
          connectorEntityId: identity,
          executorEntityId: identity,
          expectedRevision: selected.revision,
          expiresAt: new Date(Date.now() + SEO_CONNECTION_INTENT_TTL_MS),
        },
      });
      return previous.filter(
        (row) => row.connectionId !== selected.composioAccountId,
      );
    }, "SEO connection changed. Please retry.");
  } catch (error) {
    await prisma.seoConnectionIntent
      .updateMany({
        where: {
          connectionId: linked.connectionId,
          userId: owner.userId,
          finalizedAt: null,
        },
        data: { expiresAt: new Date() },
      })
      .catch(() => undefined);
    await deleteProjectSocialConnectionIntent({
      connectedAccountId: linked.connectionId,
    }).catch(() => undefined);
    throw error;
  }
  // Committed consent remains valid when cleanup of an older attempt stalls.
  for (const previous of superseded)
    await deleteProjectSocialConnectionIntent({
      connectedAccountId: previous.connectionId,
    }).catch((error) => {
      captureExternalServiceError(error, {
        label: "seo_connection_superseded_cleanup",
      });
    });
  return {
    ...linked,
    redirectUrl: composioHandoffUrl({
      redirectUrl: linked.redirectUrl,
      returnUrl: callback,
      connectionId: linked.connectionId,
    }),
  };
}

async function requireIntent(input: {
  connectionId: string;
  userId: string;
  workspaceId?: string;
  provider?: SeoConnectionProvider;
}) {
  const intent = await prisma.seoConnectionIntent.findUnique({
    where: { connectionId: input.connectionId },
  });
  if (
    !intent ||
    intent.userId !== input.userId ||
    (input.workspaceId && intent.workspaceId !== input.workspaceId) ||
    (input.provider && intent.provider !== input.provider)
  )
    throw notFound("Unknown or expired SEO connection");
  await requireSeoConnectionOwner(intent);
  const selected = await prisma.seoConnection.findUnique({
    where: {
      workspaceId_userId_provider: {
        userId: intent.userId,
        workspaceId: intent.workspaceId,
        provider: intent.provider,
      },
    },
  });
  if (
    !selected ||
    selected.revision !== intent.expectedRevision ||
    (!intent.finalizedAt && intent.expiresAt <= new Date())
  )
    throw notFound("Unknown or expired SEO connection");
  if (
    intent.connectorEntityId !== intent.executorEntityId ||
    intent.executorEntityId !== entityId(intent)
  )
    throw notFound("Unknown SEO execution identity");
  return intent;
}

/** Runs from the existing one-use Composio popup callback, only for its initiating owner. */
export async function completeSeoConnectionCallback(input: {
  connectionId: string;
  userId: string;
  sessionUri: string;
}): Promise<boolean> {
  if (
    !(await prisma.seoConnectionIntent.findUnique({
      where: { connectionId: input.connectionId },
      select: { connectionId: true },
    }))
  )
    return false;
  const intent = await requireIntent(input);
  if (intent.callbackRedeemedAt || intent.finalizedAt)
    throw notFound("Unknown or expired SEO connection");
  const completed = await completeComposioAuth({
    sessionUri: input.sessionUri,
    userId: intent.connectorEntityId,
  });
  if (
    completed.connectedAccountId !== intent.connectionId ||
    completed.toolkitSlug !== intent.toolkit
  )
    throw notFound("Unknown SEO connection account");
  // The completed one-use session proves this exact account and toolkit. Persist
  // that proof before a fallible metadata read, so activation can be retried.
  const won = await prisma.seoConnectionIntent.updateMany({
    where: {
      connectionId: intent.connectionId,
      userId: input.userId,
      callbackRedeemedAt: null,
      finalizedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { callbackRedeemedAt: new Date() },
  });
  if (won.count !== 1) throw conflict("SEO connection changed. Please retry.");
  await verifyAccount(intent);
  return true;
}

async function verifyAccount(intent: {
  connectionId: string;
  toolkit: string;
  authConfigId: string;
  connectorEntityId: string;
}) {
  const account = await getComposioConnectedAccount(intent.connectionId);
  if (
    account.id !== intent.connectionId ||
    account.toolkitSlug !== intent.toolkit ||
    account.authConfigId !== intent.authConfigId ||
    account.connectorUserId !== intent.connectorEntityId
  )
    throw notFound("Unknown SEO connection account");
  if (account.status !== "ACTIVE")
    throw conflict("The SEO connection is not active yet");
}

export async function finalizeSeoConnection(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
  connectionId?: string,
  sessionUri?: string,
) {
  if (!connectionId) {
    await requireSeoConnectionOwner(owner);
    const key = seoConnectionKey(owner, provider);
    const selected = await prisma.seoConnection.findUnique({
      where: { workspaceId_userId_provider: key },
      select: { revision: true },
    });
    const pending =
      selected &&
      (await prisma.seoConnectionIntent.findFirst({
        where: { ...key, expectedRevision: selected.revision },
        select: { connectionId: true },
      }));
    if (!pending) throw notFound("Unknown or expired SEO connection");
    connectionId = pending.connectionId;
  }
  let intent = await requireIntent({ ...owner, provider, connectionId });
  if (intent.finalizedAt) return getSeoConnection(owner, provider);
  if (!intent.callbackRedeemedAt && sessionUri) {
    await completeSeoConnectionCallback({
      ...owner,
      connectionId,
      sessionUri,
    });
    intent = await requireIntent({ ...owner, provider, connectionId });
  }
  if (!intent.callbackRedeemedAt)
    throw conflict("Complete the provider consent first");
  await verifyAccount(intent);
  const superseded = await serializableTransaction(async (tx) => {
    await requireSeoConnectionOwner(owner, tx);
    const key = seoConnectionKey(owner, provider);
    const previous = await tx.seoConnection.findUnique({
      where: { workspaceId_userId_provider: key },
    });
    const claimed = await tx.seoConnectionIntent.updateMany({
      where: {
        connectionId,
        ...key,
        finalizedAt: null,
        callbackRedeemedAt: { not: null },
        expiresAt: { gt: new Date() },
      },
      data: { finalizedAt: new Date() },
    });
    if (claimed.count !== 1)
      throw conflict("SEO connection changed. Please retry.");
    const selected = await tx.seoConnection.updateMany({
      where: { ...key, revision: intent.expectedRevision },
      data: {
        status: "ACTIVE",
        composioAccountId: connectionId,
        entityId: intent.executorEntityId,
        authConfigId: intent.authConfigId,
        connectedAt: new Date(),
      },
    });
    if (selected.count !== 1)
      throw conflict("SEO connection changed. Please retry.");
    return previous?.composioAccountId;
  }, "SEO connection changed. Please retry.");
  if (superseded && superseded !== connectionId)
    await deleteProjectSocialConnectionIntent({
      connectedAccountId: superseded,
    }).catch((error) => {
      captureExternalServiceError(error, {
        label: "seo_connection_replaced_cleanup",
      });
    });
  return getSeoConnection(owner, provider);
}

export async function disconnectSeoConnection(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
) {
  const accountIds = await serializableTransaction(async (tx) => {
    await requireSeoConnectionOwner(owner, tx);
    const key = seoConnectionKey(owner, provider);
    const selected = await tx.seoConnection.upsert({
      where: { workspaceId_userId_provider: key },
      create: { ...key, status: "DISCONNECTED", revision: 1 },
      update: { status: "DISCONNECTED", revision: { increment: 1 } },
    });
    const pending = await tx.seoConnectionIntent.findMany({
      where: { ...key, finalizedAt: null },
      select: { connectionId: true },
    });
    await tx.seoConnectionIntent.updateMany({
      where: { ...key, finalizedAt: null },
      data: { expiresAt: new Date() },
    });
    return [
      ...new Set(
        [
          selected.composioAccountId,
          ...pending.map((row) => row.connectionId),
        ].filter((id): id is string => Boolean(id)),
      ),
    ];
  }, "SEO connection changed. Please retry.");
  // Personal assistant accounts are only unselected for SEO; their own consent remains intact.
  for (const accountId of accountIds)
    await deleteProjectSocialConnectionIntent({
      connectedAccountId: accountId,
    });
  return { disconnected: true as const };
}
