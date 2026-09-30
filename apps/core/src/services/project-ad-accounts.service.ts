import type {
  Prisma,
  ProjectAdAccount,
  ProjectAdConnection,
} from "@sokosumi/database";

import {
  ComposioConfigError,
  deleteProjectSocialConnectionIntent,
  getComposioConnectedAccount,
  initiateComposioConnection,
  revokeComposioConnectedAccount,
} from "@/clients/composio.client";
import {
  isProjectAdProvider,
  PROJECT_AD_PROVIDERS,
  type ProjectAdProvider,
} from "@/config/ads-providers";
import { getEnv, getWebAppBaseUrl } from "@/config/env";
import {
  badRequest,
  conflict,
  internalServerError,
  notFound,
} from "@/helpers/error";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import type {
  AdCampaign,
  AdCampaignUpdate,
  AdRange,
} from "@/lib/ads/campaigns";
import type { AvailableAdAccount } from "@/lib/ads/composio-tools";
import {
  listGoogleAdAccounts,
  listGoogleCampaigns,
  updateGoogleCampaign,
} from "@/lib/ads/google-ads";
import {
  listMetaAdAccounts,
  listMetaCampaigns,
  updateMetaCampaign,
} from "@/lib/ads/meta-ads";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { projectAdConnectionStatusSchema } from "@/schemas/project-ad-account.schema";
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
  status: "active" | "reauthorization_required" | "disconnected";
  createdAt: Date;
}

export interface FinalizeProjectAdConnectionResult {
  /** Null when the grant reaches no ad accounts: nothing is stored and it is revoked. */
  connection: ProjectAdConnectionSummary | null;
  availableAccounts: AvailableAdAccount[];
}

export interface PendingProjectAdRevocation {
  adConnectionId: string;
  connectedAccountId: string;
}

function adProviderOf(connection: { provider: string }): ProjectAdProvider {
  if (!isProjectAdProvider(connection.provider)) {
    throw notFound("Unsupported ad provider");
  }
  return connection.provider;
}

function summarizeConnection(
  connection: ProjectAdConnection,
): ProjectAdConnectionSummary {
  const status = projectAdConnectionStatusSchema.safeParse(connection.status);
  if (!status.success) {
    throw internalServerError("Ad connection has an unknown status");
  }
  return {
    id: connection.id,
    provider: adProviderOf(connection),
    status: status.data,
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

// OAuth intents live in ProjectSocialConnectionIntent, shared with social.
export async function initiateProjectAdConnection(
  input: ProjectScope & { userId: string; provider: ProjectAdProvider },
): Promise<{ connectionId: string; redirectUrl: string }> {
  await requireScopedProject(input, { requireOpen: true });
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
 * accounts it can reach. Safe to retry: a finished connection is returned as
 * is. A grant that reaches no ad accounts is revoked and never stored.
 */
export async function finalizeProjectAdConnection(
  input: ProjectScope & { userId: string; connectionId: string },
): Promise<FinalizeProjectAdConnectionResult> {
  await requireScopedProject(input, { requireOpen: true });
  const connectorUserId = projectConnectorUserId(input.userId);

  const findExisting = async (): Promise<ProjectAdConnection | null> => {
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
  const respond = async (
    connection: ProjectAdConnection,
  ): Promise<FinalizeProjectAdConnectionResult> => ({
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

  const account = await getComposioConnectedAccount(input.connectionId);
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
  if (availableAccounts.length === 0) {
    await revokeComposioConnectedAccount({
      connectedAccountId: input.connectionId,
    });
    await prisma.projectSocialConnectionIntent.deleteMany({
      where: { connectionId: input.connectionId },
    });
    return { connection: null, availableAccounts: [] };
  }

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

/**
 * Attaches accounts the connection can reach. An account already attached to
 * the Project is returned unchanged, so repeating a request is harmless.
 */
export async function attachProjectAdAccounts(
  input: ProjectScope & {
    adConnectionId: string;
    externalAccountIds: string[];
  },
): Promise<ProjectAdAccount[]> {
  await requireScopedProject(input, { requireOpen: true });
  const connection = await prisma.projectAdConnection.findFirst({
    where: { id: input.adConnectionId, projectId: input.projectId },
  });
  if (!connection) throw notFound("Ad connection not found");
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

  return serializableTransaction(async (tx) => {
    await requireLockedOpenProject(tx, input);
    // A detach of the connection's last account closes it in its own transaction.
    const current = await tx.projectAdConnection.findUnique({
      where: { id: connection.id },
    });
    if (current?.status !== "active") {
      throw conflict("Ad connection is not active");
    }
    const accounts: ProjectAdAccount[] = [];
    for (const account of chosen) {
      accounts.push(
        await tx.projectAdAccount.upsert({
          where: {
            projectId_provider_externalAccountId: {
              projectId: input.projectId,
              provider,
              externalAccountId: account.externalAccountId,
            },
          },
          create: {
            projectId: input.projectId,
            connectionId: connection.id,
            provider,
            externalAccountId: account.externalAccountId,
            name: account.name,
            currency: account.currency,
            timeZone: account.timeZone,
          },
          update: {},
        }),
      );
    }
    return accounts;
  }, "Ad connection changed. Please retry.");
}

export async function listProjectAdAccounts(
  input: ProjectScope,
): Promise<ProjectAdAccount[]> {
  await requireScopedProject(input);
  return prisma.projectAdAccount.findMany({
    where: { projectId: input.projectId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** An ad account of the Project with an active connection, ready to call its provider. */
async function requireActiveAdAccount(
  input: ProjectScope & { accountId: string },
) {
  await requireScopedProject(input);
  const account = await prisma.projectAdAccount.findFirst({
    where: { id: input.accountId, projectId: input.projectId },
    select: {
      provider: true,
      externalAccountId: true,
      currency: true,
      connection: {
        select: { status: true, composioConnectedAccountId: true },
      },
    },
  });
  if (!account) throw notFound("Ad account not found");
  if (account.connection.status !== "active") {
    throw conflict("Ad connection is not active");
  }
  return {
    provider: adProviderOf(account),
    externalAccountId: account.externalAccountId,
    currency: account.currency,
    connected: {
      connectedAccountId: account.connection.composioConnectedAccountId,
      executorUserId: projectExecutorUserId(input.projectId),
    },
  };
}

/** Campaigns of an attached ad account with metrics over the range. */
export async function listProjectAdCampaigns(
  input: ProjectScope & { accountId: string; range: AdRange },
): Promise<{ campaigns: AdCampaign[]; range: AdRange; currency: string }> {
  const account = await requireActiveAdAccount(input);
  const providerInput = { ...account.connected, range: input.range };
  const campaigns =
    account.provider === "google_ads"
      ? await listGoogleCampaigns({
          ...providerInput,
          customerId: account.externalAccountId,
        })
      : await listMetaCampaigns({
          ...providerInput,
          adAccountId: account.externalAccountId,
          currency: account.currency,
        });
  return { campaigns, range: input.range, currency: account.currency };
}

/**
 * Pauses, resumes and/or changes the daily budget of a campaign of an attached
 * ad account. The provider modules prove the campaign belongs to that account
 * before they write.
 */
export async function updateProjectAdCampaign(
  input: ProjectScope &
    AdCampaignUpdate & { accountId: string; campaignId: string },
): Promise<void> {
  const account = await requireActiveAdAccount(input);
  const change = {
    ...account.connected,
    campaignId: input.campaignId,
    status: input.status,
    dailyBudget: input.dailyBudget,
  };
  if (account.provider === "google_ads") {
    await updateGoogleCampaign({
      ...change,
      customerId: account.externalAccountId,
    });
  } else {
    await updateMetaCampaign({
      ...change,
      adAccountId: account.externalAccountId,
    });
  }
}

/**
 * Detaches an ad account. The connection's last account also revokes the
 * Composio authorization: the connection is first closed to new attaches (in
 * the same transaction that sees it is last), then revoked, then deleted. A
 * failed revoke reopens it, so the detach can be retried.
 */
export async function detachProjectAdAccount(
  input: ProjectScope & { accountId: string },
): Promise<void> {
  await requireScopedProject(input);
  const closing = await serializableTransaction(async (tx) => {
    const account = await tx.projectAdAccount.findFirst({
      where: { id: input.accountId, projectId: input.projectId },
      include: { connection: true },
    });
    if (!account) throw notFound("Ad account not found");
    const siblings = await tx.projectAdAccount.count({
      where: { connectionId: account.connectionId, NOT: { id: account.id } },
    });
    if (siblings > 0) {
      await tx.projectAdAccount.delete({ where: { id: account.id } });
      return null;
    }
    await tx.projectAdConnection.update({
      where: { id: account.connectionId },
      data: { status: "disconnected" },
    });
    return {
      adConnectionId: account.connectionId,
      connectedAccountId: account.connection.composioConnectedAccountId,
      previousStatus: account.connection.status,
    };
  }, "Ad account changed. Please retry.");
  if (!closing) return;

  try {
    await revokeComposioConnectedAccount({
      connectedAccountId: closing.connectedAccountId,
    });
  } catch (error) {
    await prisma.projectAdConnection.updateMany({
      where: { id: closing.adConnectionId },
      data: { status: closing.previousStatus },
    });
    throw error;
  }
  await prisma.projectAdConnection.deleteMany({
    where: { id: closing.adConnectionId },
  });
}

/** Called inside the close loop's transaction: the next ad grant still to revoke. */
export async function getPendingProjectAdRevocation(
  tx: Pick<Prisma.TransactionClient, "projectAdConnection">,
  projectId: string,
): Promise<PendingProjectAdRevocation | null> {
  const connection = await tx.projectAdConnection.findFirst({
    where: { projectId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, composioConnectedAccountId: true },
  });
  return connection
    ? {
        adConnectionId: connection.id,
        connectedAccountId: connection.composioConnectedAccountId,
      }
    : null;
}

/** Revokes first, so a failed revoke leaves the connection for the next attempt. */
export async function revokeProjectAdConnectionForClose(
  pending: PendingProjectAdRevocation,
): Promise<void> {
  await revokeComposioConnectedAccount({
    connectedAccountId: pending.connectedAccountId,
  });
  await prisma.projectAdConnection.deleteMany({
    where: { id: pending.adConnectionId },
  });
}
