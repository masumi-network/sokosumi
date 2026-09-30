import {
  ComposioConfigError,
  deleteProjectSocialConnectionIntent,
  getProjectSocialConnectedAccount,
  initiateProjectSocialConnection as initiateComposioConnection,
  revokeProjectSocialConnection,
} from "@/clients/composio.client";
import {
  isProjectAdProvider,
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import { badRequest, conflict, notFound } from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import type { AvailableAdAccount } from "@/lib/ads/composio-tools";
import { listGoogleAdAccounts } from "@/lib/ads/google-ads";
import { listMetaAdAccounts } from "@/lib/ads/meta-ads";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  projectConnectorUserId,
  projectExecutorUserId,
  requireLockedOpenProject,
  requireScopedProject,
} from "@/services/project-social-connections.service";

const INTENT_TTL_MS = 15 * 60 * 1000;

interface ProjectScope {
  projectId: string;
  workspaceId: string;
}

export interface ProjectAdConnectionSummary {
  id: string;
  provider: ProjectAdProvider;
  status: string;
  createdAt: Date;
}

interface ProjectAdConnectionRecord {
  id: string;
  projectId: string;
  provider: string;
  composioConnectedAccountId: string;
  connectorUserId: string;
  status: string;
  createdAt: Date;
}

function adProviderOf(connection: { provider: string }): ProjectAdProvider {
  if (!isProjectAdProvider(connection.provider)) {
    throw notFound("Unsupported ad provider");
  }
  return connection.provider;
}

function summarizeConnection(
  connection: ProjectAdConnectionRecord,
): ProjectAdConnectionSummary {
  return {
    id: connection.id,
    provider: adProviderOf(connection),
    status: connection.status,
    createdAt: connection.createdAt,
  };
}

function listAvailableAccounts(connection: {
  projectId: string;
  provider: string;
  composioConnectedAccountId: string;
}): Promise<AvailableAdAccount[]> {
  const input = {
    connectedAccountId: connection.composioConnectedAccountId,
    executorUserId: projectExecutorUserId(connection.projectId),
  };
  return adProviderOf(connection) === "google_ads"
    ? listGoogleAdAccounts(input)
    : listMetaAdAccounts(input);
}

function requireAdAuthConfigId(provider: ProjectAdProvider): string {
  const { authConfigEnv } = PROJECT_AD_PROVIDERS[provider];
  const authConfigId = getEnv()[authConfigEnv];
  if (!authConfigId) {
    throw new ComposioConfigError(
      `${authConfigEnv} is not configured for Project ad connections`,
    );
  }
  return authConfigId;
}

export async function initiateProjectAdConnection(
  input: ProjectScope & { userId: string; provider: ProjectAdProvider },
): Promise<{ connectionId: string; redirectUrl: string }> {
  await requireScopedProject(input, prisma, true);
  const authConfigId = requireAdAuthConfigId(input.provider);
  const connection = await initiateComposioConnection({
    authConfigId,
    connectorUserId: projectConnectorUserId(input.userId),
    executorUserId: projectExecutorUserId(input.projectId),
    callbackUrl: `${getWebAppBaseUrl()}/composio/callback`,
  });
  try {
    await serializableTransaction(async (tx) => {
      await requireLockedOpenProject(tx, input);
      await tx.projectSocialConnectionIntent.create({
        data: {
          connectionId: connection.connectionId,
          projectId: input.projectId,
          initiatingUserId: input.userId,
          provider: input.provider,
          action: "connect",
          authConfigId,
          expiresAt: new Date(Date.now() + INTENT_TTL_MS),
        },
      });
    }, "Project changed while connecting an ad account");
  } catch (error) {
    // The hosted link has not left Core, so this unclaimed account cannot be used.
    await deleteProjectSocialConnectionIntent({
      connectedAccountId: connection.connectionId,
    });
    throw error;
  }
  return connection;
}

/**
 * Turns a redeemed OAuth callback into a ProjectAdConnection and lists the ad
 * accounts it can reach. Safe to retry: a finished connection is returned as is.
 */
export async function finalizeProjectAdConnection(
  input: ProjectScope & { userId: string; connectionId: string },
): Promise<{
  connection: ProjectAdConnectionSummary;
  availableAccounts: AvailableAdAccount[];
}> {
  await requireScopedProject(input, prisma, true);
  const connectorUserId = projectConnectorUserId(input.userId);

  const findExisting = async () => {
    const existing = await prisma.projectAdConnection.findUnique({
      where: { composioConnectedAccountId: input.connectionId },
    });
    if (!existing) return null;
    if (
      existing.projectId !== input.projectId ||
      existing.connectorUserId !== connectorUserId
    ) {
      throw notFound("Unknown or expired connection");
    }
    return existing;
  };
  const respond = async (connection: ProjectAdConnectionRecord) => ({
    connection: summarizeConnection(connection),
    availableAccounts: await listAvailableAccounts(connection),
  });

  const existing = await findExisting();
  if (existing) return respond(existing);

  const intent = await prisma.projectSocialConnectionIntent.findUnique({
    where: { connectionId: input.connectionId },
  });
  if (
    !intent ||
    intent.projectId !== input.projectId ||
    intent.initiatingUserId !== input.userId ||
    !isProjectAdProvider(intent.provider) ||
    intent.callbackRedeemedAt === null ||
    intent.expiresAt <= new Date()
  ) {
    throw notFound("Unknown or expired connection");
  }
  const provider = intent.provider;

  const account = await getProjectSocialConnectedAccount(input.connectionId);
  if (
    account.id !== input.connectionId ||
    account.toolkitSlug !== PROJECT_AD_PROVIDERS[provider].toolkitSlug ||
    account.authConfigId !== intent.authConfigId ||
    account.connectorUserId !== connectorUserId
  ) {
    throw notFound("Unknown or expired connection");
  }
  if (account.status !== "ACTIVE") {
    throw conflict("Connection is not active");
  }

  // List accounts before storing anything, so a provider failure leaves the intent retryable.
  const availableAccounts = await listAvailableAccounts({
    projectId: input.projectId,
    provider,
    composioConnectedAccountId: input.connectionId,
  });

  try {
    const connection = await serializableTransaction(async (tx) => {
      await requireLockedOpenProject(tx, input);
      const current = await tx.projectSocialConnectionIntent.findUnique({
        where: { connectionId: input.connectionId },
      });
      if (!current || current.callbackRedeemedAt === null) {
        throw notFound("Unknown or expired connection");
      }
      const created = await tx.projectAdConnection.create({
        data: {
          projectId: input.projectId,
          provider,
          composioConnectedAccountId: input.connectionId,
          connectorUserId,
          status: "active",
        },
      });
      await tx.projectSocialConnectionIntent.delete({
        where: { connectionId: input.connectionId },
      });
      return created;
    }, "Project ad connection changed. Please retry.");
    return { connection: summarizeConnection(connection), availableAccounts };
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) throw error;
    // A concurrent finalize won the race.
    const winner = await findExisting();
    if (!winner) throw error;
    return { connection: summarizeConnection(winner), availableAccounts };
  }
}

export async function attachProjectAdAccounts(
  input: ProjectScope & { connectionId: string; externalAccountIds: string[] },
) {
  await requireScopedProject(input, prisma, true);
  const connection = await prisma.projectAdConnection.findFirst({
    where: { id: input.connectionId, projectId: input.projectId },
  });
  if (!connection) throw notFound("Ad connection not found");
  if (connection.status !== "active") {
    throw conflict("Ad connection is not active");
  }
  const provider = adProviderOf(connection);

  const available = new Map(
    (await listAvailableAccounts(connection)).map((account) => [
      account.externalAccountId,
      account,
    ]),
  );
  const chosen = [...new Set(input.externalAccountIds)].map((id) => {
    const account = available.get(id);
    if (!account) {
      throw badRequest("Ad account is not available on this connection");
    }
    return account;
  });

  const previous = await prisma.projectAdAccount.findMany({
    where: {
      projectId: input.projectId,
      provider,
      externalAccountId: { in: chosen.map((a) => a.externalAccountId) },
      NOT: { connectionId: connection.id },
    },
    select: { connectionId: true },
  });
  const accounts = await prisma.$transaction(
    chosen.map((account) => {
      const data = {
        connectionId: connection.id,
        loginCustomerId: account.loginCustomerId,
        name: account.name,
        currency: account.currency,
        timeZone: account.timeZone,
      };
      return prisma.projectAdAccount.upsert({
        where: {
          projectId_provider_externalAccountId: {
            projectId: input.projectId,
            provider,
            externalAccountId: account.externalAccountId,
          },
        },
        create: {
          ...data,
          projectId: input.projectId,
          provider,
          externalAccountId: account.externalAccountId,
        },
        update: data,
      });
    }),
  );

  // Accounts moved to this grant may have emptied an older one.
  for (const { connectionId } of new Set(previous)) {
    await releaseUnusedConnection(connectionId);
  }
  return accounts;
}

export async function listProjectAdAccounts(input: ProjectScope) {
  await requireScopedProject(input);
  return prisma.projectAdAccount.findMany({
    where: { projectId: input.projectId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** Revokes and deletes a connection left without ad accounts; a failed revoke never blocks the caller. */
async function releaseUnusedConnection(connectionId: string): Promise<void> {
  const connection = await prisma.projectAdConnection.findUnique({
    where: { id: connectionId },
    include: { _count: { select: { accounts: true } } },
  });
  if (!connection || connection._count.accounts > 0) return;
  try {
    await revokeProjectSocialConnection({
      connectedAccountId: connection.composioConnectedAccountId,
    });
  } catch {
    console.warn("[ads] revoke of an unused ad connection failed");
  }
  await prisma.projectAdConnection.delete({ where: { id: connection.id } });
}

export async function detachProjectAdAccount(
  input: ProjectScope & { accountId: string },
): Promise<void> {
  await requireScopedProject(input);
  const account = await prisma.projectAdAccount.findFirst({
    where: { id: input.accountId, projectId: input.projectId },
    include: { connection: true },
  });
  if (!account) throw notFound("Ad account not found");

  const siblings = await prisma.projectAdAccount.count({
    where: { connectionId: account.connectionId, NOT: { id: account.id } },
  });
  if (siblings > 0) {
    await prisma.projectAdAccount.delete({ where: { id: account.id } });
    return;
  }
  // Last account: revoke first, so a failed revoke leaves everything retryable.
  await revokeProjectSocialConnection({
    connectedAccountId: account.connection.composioConnectedAccountId,
  });
  await prisma.projectAdConnection.delete({
    where: { id: account.connectionId },
  });
}
