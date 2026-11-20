import { createHash } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import {
  getComposio,
  getComposioConnectedAccount,
} from "@/clients/composio.client";
import { conflict, notFound } from "@/helpers/error";
import { requireAssignedOrganizationSeat } from "@/helpers/organization-assigned-seat";
import prisma from "@/lib/db/prisma";
import { captureExternalServiceError } from "@/lib/external-service-errors";
import {
  type GoogleAccountIdentity,
  readGoogleAccountIdentity,
} from "@/lib/seo/google-account-identity";
import type { SeoActor } from "@/schemas/project-seo.schema";
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
import { seoOwnerWhere } from "./project-seo-store";

export interface SeoConnectionOwner {
  userId: string;
  workspaceId: string;
}
export interface SeoStatisticsIntegration extends ComposioIntegrationAccount {
  entityId: string;
  connectionRevision: string;
}
export function connectionVersion(account: {
  composioAccountId: string;
  entityId: string;
  connectionRevision: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        account.composioAccountId,
        account.entityId,
        account.connectionRevision,
      ]),
    )
    .digest("hex");
}
/** Written with every account change, so a switched account never shows the old one. */
export const CLEARED_SEO_ACCOUNT_IDENTITY = {
  accountEmail: null,
  accountName: null,
  accountPictureUrl: null,
  accountCheckedAt: null,
};

/** A failed or refused read is tried again after this time, not on every status read. */
const IDENTITY_RETRY_MS = 60 * 60 * 1000;

/** True when the selected account has no stored identity and no read in the last retry period. */
function identityReadDue(row: {
  accountEmail: string | null;
  accountCheckedAt: Date | null;
}) {
  return (
    row.accountEmail === null &&
    (row.accountCheckedAt === null ||
      row.accountCheckedAt.getTime() < Date.now() - IDENTITY_RETRY_MS)
  );
}

/**
 * Reads the Google identity of the selected native account. The claim on
 * accountCheckedAt lets one caller read per retry period, so a temporary
 * failure does not hide the account for good. A finalize claims in its own
 * transaction and passes `claimed`. Never throws: the identity is display
 * data only.
 */
export async function recordSeoConnectionIdentity(
  account: { composioAccountId: string; entityId: string },
  { claimed = false } = {},
): Promise<GoogleAccountIdentity | null> {
  const selected = {
    composioAccountId: account.composioAccountId,
    entityId: account.entityId,
    status: "ACTIVE",
  };
  try {
    const claim = claimed
      ? { count: 1 }
      : await prisma.seoConnection.updateMany({
          where: {
            ...selected,
            accountEmail: null,
            OR: [
              { accountCheckedAt: null },
              {
                accountCheckedAt: {
                  lt: new Date(Date.now() - IDENTITY_RETRY_MS),
                },
              },
            ],
          },
          data: { accountCheckedAt: new Date() },
        });
    if (claim.count !== 1) return null;
    const identity = await readGoogleAccountIdentity({
      connectedAccountId: account.composioAccountId,
      executorUserId: account.entityId,
    });
    if (identity)
      await prisma.seoConnection.updateMany({
        where: selected,
        data: {
          accountEmail: identity.email,
          accountName: identity.name,
          accountPictureUrl: identity.pictureUrl,
        },
      });
    return identity;
  } catch (error) {
    captureExternalServiceError(error, {
      label: "seo_connection_identity_store",
      // Fixed text: a failed write can quote the email it tried to store.
      message: "SEO connection identity could not be stored",
    });
    return null;
  }
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
  tx: Prisma.TransactionClient = prisma,
) {
  const rows = await tx.sokoBotIntegration.findMany({
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
    select: { composioAccountId: true, sokoBotId: true, updatedAt: true },
    take: 2,
  });
  if (rows.length > 1)
    throw conflict("Choose one active native connection for statistics");
  const row = rows[0];
  return row
    ? {
        composioAccountId: row.composioAccountId,
        entityId: composioEntityId(row.sokoBotId),
        connectionRevision: `personal:${row.updatedAt.toISOString()}`,
      }
    : null;
}

/** Reading never creates an account, OAuth attempt, assistant, or consent. */
export async function resolveSeoStatisticsIntegration(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
  tx: Prisma.TransactionClient = prisma,
): Promise<SeoStatisticsIntegration | null> {
  await requireSeoConnectionOwner(owner, tx);
  const selected = await tx.seoConnection.findUnique({
    where: { workspaceId_userId_provider: seoConnectionKey(owner, provider) },
  });
  const account =
    selected?.status === "ACTIVE" &&
    selected.composioAccountId &&
    selected.entityId
      ? {
          composioAccountId: selected.composioAccountId,
          entityId: selected.entityId,
          connectionRevision: `native:${selected.id}:${selected.revision}`,
        }
      : !selected || selected.status === "INHERIT"
        ? await personalConnection(owner, provider, tx)
        : null;
  return account
    ? {
        ...account,
        provider: resolveProvider(SEO_CONNECTION_PROVIDERS[provider].toolkit),
      }
    : null;
}

export async function lockSeoSearchConsoleIntegration(
  actor: SeoConnectionOwner,
  tx: Prisma.TransactionClient,
) {
  // These no-op writes serialize disconnect/replacement and inherited account revocation with the final save.
  await tx.$executeRaw`
    UPDATE "seo_connection" SET "updatedAt" = "updatedAt"
    WHERE "workspaceId" = ${actor.workspaceId}::uuid AND "userId" = ${actor.userId} AND provider = 'search_console'
  `;
  let integration = await resolveSeoStatisticsIntegration(
    actor,
    "search_console",
    tx,
  );
  if (integration?.connectionRevision.startsWith("personal:")) {
    await tx.$executeRaw`
      UPDATE "soko_bot_integration" SET "updatedAt" = "updatedAt"
      WHERE "composioAccountId" = ${integration.composioAccountId}
    `;
    await tx.$executeRaw`
      UPDATE "soko_bot" SET "updatedAt" = "updatedAt" WHERE id IN (
        SELECT "sokoBotId" FROM "soko_bot_integration" WHERE "composioAccountId" = ${integration.composioAccountId}
      )
    `;
    integration = await resolveSeoStatisticsIntegration(
      actor,
      "search_console",
      tx,
    );
  }
  return integration;
}

export async function latestSeoSearchConsoleProperty(
  actor: SeoActor,
  pageIds: string[],
  tx: Prisma.TransactionClient = prisma,
) {
  const latest = await tx.projectSeoObservation.findFirst({
    where: {
      ...seoOwnerWhere(actor),
      ownerId: actor.userId,
      kind: "metrics",
      source: "search_console",
      pageIds: { hasEvery: pageIds },
    },
    orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: { payload: true },
  });
  const selection = z
    .object({ propertyId: z.string().min(1).max(500) })
    .safeParse(latest?.payload);
  return selection.success ? selection.data.propertyId : null;
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
  const pending =
    row &&
    (await prisma.seoConnectionIntent.findFirst({
      where: {
        ...seoConnectionKey(owner, provider),
        expectedRevision: row.revision,
        finalizedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { connectionId: true, callbackRedeemedAt: true },
    }));
  if (pending)
    return seoConnectionStatusSchema.parse({
      ...base,
      status: "pending",
      source: "native",
      pendingConnectionId: pending.connectionId,
      canResume: pending.callbackRedeemedAt !== null,
    });
  if (row?.status === "ACTIVE" && row.composioAccountId && row.entityId) {
    // A new account, or one whose last read failed, is read here.
    const identity = identityReadDue(row)
      ? await recordSeoConnectionIdentity({
          composioAccountId: row.composioAccountId,
          entityId: row.entityId,
        })
      : row.accountEmail
        ? {
            email: row.accountEmail,
            name: row.accountName,
            pictureUrl: row.accountPictureUrl,
          }
        : null;
    return seoConnectionStatusSchema.parse({
      ...base,
      status: "connected",
      source: "native",
      account: identity,
      connectionVersion: connectionVersion({
        composioAccountId: row.composioAccountId,
        entityId: row.entityId,
        connectionRevision: `native:${row.id}:${row.revision}`,
      }),
    });
  }
  const inherited =
    !row || row.status === "INHERIT"
      ? await personalConnection(owner, provider)
      : null;
  if (inherited)
    return seoConnectionStatusSchema.parse({
      ...base,
      status: "connected",
      source: "personal",
      account: null,
      connectionVersion: connectionVersion(inherited),
    });
  return seoConnectionStatusSchema.parse({
    ...base,
    status:
      row?.status === "NEEDS_RECONNECT" ? "needs_reconnect" : "not_connected",
    source: "none",
  });
}

/** Only a failed statistics read checks remote health. Status reads stay local. */
export async function recordSeoConnectionFailure(
  owner: SeoConnectionOwner,
  provider: SeoConnectionProvider,
  integration: ComposioIntegrationAccount,
) {
  try {
    const account = await getComposioConnectedAccount(
      integration.composioAccountId,
    );
    if (
      account.id !== integration.composioAccountId ||
      account.connectorUserId !== integration.entityId ||
      account.toolkitSlug !== SEO_CONNECTION_PROVIDERS[provider].toolkit ||
      !["EXPIRED", "REVOKED", "INACTIVE", "FAILED"].includes(account.status)
    )
      return;
    await requireSeoConnectionOwner(owner);
    const key = seoConnectionKey(owner, provider);
    const data = { status: "NEEDS_RECONNECT" };
    const selected = await prisma.seoConnection.findUnique({
      where: { workspaceId_userId_provider: key },
    });
    if (!selected) {
      // Reused assistant consent stays owned by that assistant. Keep only an
      // SEO tombstone, so later native replacement never revokes that account.
      // A unique owner/provider constraint lets a concurrent replacement win.
      await prisma.seoConnection
        .create({ data: { ...key, ...data } })
        .catch(() => undefined);
      return;
    }
    await prisma.seoConnection.updateMany({
      where: {
        ...key,
        revision: selected.revision,
        ...(selected.status === "INHERIT"
          ? { status: "INHERIT", composioAccountId: null }
          : {
              status: "ACTIVE",
              composioAccountId: integration.composioAccountId,
              entityId: integration.entityId,
              authConfigId: account.authConfigId,
            }),
      },
      data,
    });
  } catch {
    // An outage is not proof that the owner's Google consent expired.
  }
}
