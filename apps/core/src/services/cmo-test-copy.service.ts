import type { Prisma } from "@sokosumi/database";
import { getEnv } from "@/config/env";
import { isOnEmailAllowlist } from "@/helpers/email-allowlist";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
  cmoPayer,
  findCusoForProject,
  LIVE_CUSO_WHERE,
} from "@/services/cmo-cuso.service";

/**
 * A CMO test copy (ADR 0073): a Cuso hired as the copy of another Cuso in the
 * same organization, to test CMO end to end. His Project carries the mark
 * (`testCopyOfProjectId`), and his Social connections are links to the
 * source's connected accounts, so nobody signs in again. A link never ends
 * the account at the provider, and nothing of a test copy ever publishes.
 */

/**
 * Who may make a test copy of this Cuso: an owner or admin of his
 * organization, or a tester (`CMO_SUBSCRIPTION_SKIP_ALLOWLIST`) who belongs to
 * it. The copy goes into the source's organization, which this answers,
 * never another.
 */
export async function requireTestCopySource(input: {
  userId: string;
  sourceProjectId: string;
  /** Where the caller asked to hire, if they said. */
  organizationId: string | undefined;
}): Promise<string> {
  // 404 unless the caller is a member of the source's organization.
  const source = await findCusoForProject({
    userId: input.userId,
    projectId: input.sourceProjectId,
  });
  if (!source) throw new CmoNotFoundError("The Cuso to copy is not hired");
  const { organizationId } = await cmoPayer(source);
  if (input.organizationId && input.organizationId !== organizationId) {
    throw new CmoForbiddenError(
      "A test copy goes into the organization of the Cuso it copies",
    );
  }
  const [project, member] = await Promise.all([
    prisma.project.findUnique({
      where: { id: source.projectId },
      select: { testCopyOfProjectId: true },
    }),
    prisma.member.findFirst({
      where: { userId: input.userId, organizationId },
      select: { role: true },
    }),
  ]);
  if (project?.testCopyOfProjectId) {
    throw new CmoConflictError("A test copy cannot be copied");
  }
  const mayCopy =
    (member !== null && isOrganizationOwnerOrAdmin(member.role)) ||
    (await isOnEmailAllowlist(
      input.userId,
      getEnv().CMO_SUBSCRIPTION_SKIP_ALLOWLIST,
      { requireVerifiedEmail: true },
    ));
  if (!mayCopy) {
    throw new CmoForbiddenError(
      "Only an organization owner or admin, or a tester, makes a test copy",
    );
  }
  return organizationId;
}

/**
 * Links the source's active Social connections to the test copy: one row per
 * account on the copy's Project, naming the same connected account and the
 * executor it was granted to. The source's rows are only read.
 */
export async function linkTestCopyConnections(input: {
  projectId: string;
  sourceProjectId: string;
  actorId: string;
}): Promise<number> {
  const sources = await prisma.projectSocialConnection.findMany({
    where: { projectId: input.sourceProjectId, status: "active" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const now = new Date();
  await prisma.$transaction(
    sources.map((source) =>
      prisma.projectSocialConnection.create({
        data: {
          projectId: input.projectId,
          provider: source.provider,
          externalAccountId: source.externalAccountId,
          externalHandle: source.externalHandle,
          displayName: source.displayName,
          avatarUrl: source.avatarUrl,
          subscriptionType: source.subscriptionType,
          composioConnectedAccountId: source.composioConnectedAccountId,
          // The TikTok profile stays the source's alone: a link has nothing
          // to release.
          zernioProfileId: null,
          executorProjectId: source.executorProjectId ?? source.projectId,
          status: "active",
          activeExternalAccountKey: source.activeExternalAccountKey,
          connectorUserId: source.connectorUserId,
          connectedAt: now,
          audits: {
            create: {
              action: "test_copy_link",
              actorId: input.actorId,
              externalAccountId: source.externalAccountId,
              externalHandle: source.externalHandle,
              connectedAccountId: source.composioConnectedAccountId,
              providerOutcome: "active",
            },
          },
        },
      }),
    ),
  );
  return sources.length;
}

/**
 * The Cuso whose measurement accounts (Analytics, Search Console, Shopify)
 * this Cuso reads: his source's, when he is a test copy. Null for every other
 * bot, and once the source is gone. A test copy only reads them.
 */
export async function testCopySourceBotId(
  sokoBotId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  const bot = await db.sokoBot.findUnique({
    where: { id: sokoBotId },
    select: { project: { select: { testCopyOfProjectId: true } } },
  });
  const sourceProjectId = bot?.project?.testCopyOfProjectId;
  if (!sourceProjectId) return null;
  const source = await db.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId: sourceProjectId },
    select: { id: true },
  });
  return source?.id ?? null;
}
