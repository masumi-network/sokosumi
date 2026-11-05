import type { Prisma } from "@sokosumi/database";
import { getComposio } from "@/clients/composio.client";
import { conflict, notFound } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import {
  SEO_CONNECTION_PROVIDERS,
  type SeoConnectionProvider,
  seoConnectionStatusSchema,
} from "@/schemas/seo-connection.schema";
import {
  type ComposioIntegrationAccount,
  composioEntityId,
} from "@/services/composio-integration-tools.service";
import { resolveProvider } from "@/services/soko-bot-integrations.service";

export interface SeoConnectionOwner {
  userId: string;
  workspaceId: string;
}
export function seoConnectionKey(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
) {
  return { workspaceId: owner.workspaceId, userId: owner.userId, provider };
}

/** Consent and reads require current membership, including callbacks after an owner leaves. */
export async function requireSeoConnectionOwner(
  owner: SeoConnectionOwner,
  tx: Prisma.TransactionClient = prisma,
) {
  const workspace = await tx.workspace.findFirst({
    where: {
      id: owner.workspaceId,
      OR: [
        { userId: owner.userId },
        { organization: { members: { some: { userId: owner.userId } } } },
      ],
    },
    select: { organizationId: true },
  });
  if (!workspace) throw notFound("Workspace not found");
  await requireAssignedOrganizationSeat(
    owner.userId,
    workspace.organizationId,
    tx,
  );
}

async function personalConnection(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
) {
  const rows = await prisma.sokoBotIntegration.findMany({
    where: {
      provider: SEO_CONNECTION_PROVIDERS[provider].toolkit,
      status: "ACTIVE",
      OR: [{ connectorUserId: null }, { connectorUserId: owner.userId }],
      sokoBot: {
        userId: owner.userId,
        workspaceId: owner.workspaceId,
        projectId: null,
        archivedAt: null,
        deletedAt: null,
      },
    },
    select: { composioAccountId: true, sokoBotId: true },
    take: 2,
  });
  if (rows.length > 1)
    throw conflict("Choose one active native connection for statistics");
  const row = rows[0];
  return row
    ? {
        composioAccountId: row.composioAccountId,
        entityId: composioEntityId(row.sokoBotId),
      }
    : null;
}

/** Reading never creates an account, OAuth attempt, assistant, or consent. */
export async function resolveSeoStatisticsIntegration(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
): Promise<ComposioIntegrationAccount | null> {
  await requireSeoConnectionOwner(owner);
  const selected = await prisma.seoConnection.findUnique({
    where: { workspaceId_userId_provider: seoConnectionKey(owner, provider) },
  });
  const account =
    selected?.status === "ACTIVE" &&
    selected.composioAccountId &&
    selected.entityId
      ? {
          composioAccountId: selected.composioAccountId,
          entityId: selected.entityId,
        }
      : !selected || selected.status === "INHERIT"
        ? await personalConnection(owner, provider)
        : null;
  return account
    ? {
        ...account,
        provider: resolveProvider(SEO_CONNECTION_PROVIDERS[provider].toolkit),
      }
    : null;
}

export async function getSeoConnection(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
) {
  await requireSeoConnectionOwner(owner);
  const base = { provider, name: SEO_CONNECTION_PROVIDERS[provider].name };
  if (!getComposio())
    return seoConnectionStatusSchema.parse({
      ...base,
      status: "unavailable",
      source: "none",
    });
  const row = await prisma.seoConnection.findUnique({
    where: { workspaceId_userId_provider: seoConnectionKey(owner, provider) },
  });
  if (row?.status === "ACTIVE" && row.composioAccountId && row.entityId)
    return seoConnectionStatusSchema.parse({
      ...base,
      status: "connected",
      source: "native",
    });
  if (
    (!row || row.status === "INHERIT") &&
    (await personalConnection(owner, provider))
  )
    return seoConnectionStatusSchema.parse({
      ...base,
      status: "connected",
      source: "personal",
    });
  const pending =
    row &&
    (await prisma.seoConnectionIntent.findFirst({
      where: {
        ...seoConnectionKey(owner, provider),
        expectedRevision: row.revision,
        finalizedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { connectionId: true },
    }));
  return seoConnectionStatusSchema.parse({
    ...base,
    status: pending ? "pending" : "not_connected",
    source: pending ? "native" : "none",
  });
}
