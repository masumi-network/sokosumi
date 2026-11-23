import { MemberRole, type Prisma } from "@sokosumi/database";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";
import { getEnv } from "@/config/env";
import { isOnEmailAllowlist } from "@/helpers/email-allowlist";
import { isOrganizationOwnerOrAdmin } from "@/helpers/organization-role";
import {
  flagSocialPostQuotes,
  QUOTED_POST_CANCELLED,
} from "@/helpers/social-post-quote";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { requireProjectAccessForUser } from "@/lib/image-studio/access";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  CmoConflictError,
  CmoForbiddenError,
  CmoNotFoundError,
  type CusoTarget,
  cmoPayer,
  findCusoForProject,
  LIVE_CUSO_WHERE,
} from "@/services/cmo-cuso.service";
import {
  madeTestCopy,
  TEST_COPY_LIFETIME_MS,
} from "@/services/project-test-copy";

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
  // A source the caller cannot see reads as one that is not hired: the
  // refusal names no Project of another organization.
  const source = await findCusoForProject({
    userId: input.userId,
    projectId: input.sourceProjectId,
  }).catch((error: unknown) => {
    if (error instanceof HTTPException && error.status === 404) return null;
    throw error;
  });
  if (!source)
    throw new CmoNotFoundError(
      "The Cuso to copy is not hired",
      CORE_API_ERROR_KINDS.CMO_TEST_COPY_SOURCE_NOT_HIRED,
    );
  const { organizationId } = await cmoPayer(source);
  if (input.organizationId && input.organizationId !== organizationId) {
    throw new CmoForbiddenError(
      "A test copy goes into the organization of the Cuso it copies",
      CORE_API_ERROR_KINDS.CMO_TEST_COPY_OTHER_ORGANIZATION,
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
    throw new CmoConflictError(
      "A test copy cannot be copied",
      CORE_API_ERROR_KINDS.CMO_TEST_COPY_OF_TEST_COPY,
    );
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
      CORE_API_ERROR_KINDS.CMO_TEST_COPY_NOT_ALLOWED,
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

/** Posts that have not gone out: a torn-down copy keeps none of them. */
const UNSENT_POST_STATUSES = [
  "DRAFT",
  "NEEDS_APPROVAL",
  "SCHEDULED",
  "FAILED",
  "MISSED",
] as const;

/** What is left of a test copy; all zero and false once it is torn down. */
export interface TestCopyCheck {
  projectId: string;
  sourceProjectId: string;
  tornDownAt: Date | null;
  /** Nothing is left: no unsent post, no linked account, no Cuso, no run. */
  clean: boolean;
  left: {
    unsentPosts: number;
    linkedAccounts: number;
    activeTurns: number;
    liveCuso: boolean;
  };
  /** Posts of the copy that went out. A test copy never publishes: always 0. */
  publishedPosts: number;
  /** Accounts ended at the provider through the copy: always 0. */
  providerRevocations: number;
}

/** What a teardown removed, and what is left after it. */
export interface TestCopyTeardown {
  removed: {
    canceledPosts: number;
    unlinkedAccounts: number;
    stoppedTurns: number;
    archivedCuso: boolean;
  };
  check: TestCopyCheck;
}

async function requireTestCopyProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      workspaceId: true,
      testCopyOfProjectId: true,
      testCopyTornDownAt: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (!project?.testCopyOfProjectId) {
    throw new CmoNotFoundError("That Project is not a test copy");
  }
  return { ...project, sourceProjectId: project.testCopyOfProjectId };
}

/** Says what is left of a test copy (CodePat calls it after each teardown). */
export async function checkTestCopy(projectId: string): Promise<TestCopyCheck> {
  const project = await requireTestCopyProject(projectId);
  const [
    unsentPosts,
    linkedAccounts,
    activeTurns,
    liveCusos,
    publishedPosts,
    providerRevocations,
  ] = await Promise.all([
    prisma.socialPost.count({
      where: { projectId, status: { in: [...UNSENT_POST_STATUSES] } },
    }),
    prisma.projectSocialConnection.count({
      where: { projectId, status: { not: "disconnected" } },
    }),
    prisma.sokoBotTurn.count({
      where: {
        sokoBot: { projectId },
        status: { in: ["QUEUED", "STARTING", "RUNNING"] },
      },
    }),
    prisma.sokoBot.count({ where: { ...LIVE_CUSO_WHERE, projectId } }),
    prisma.socialPost.count({
      where: {
        projectId,
        OR: [
          { status: { in: ["PUBLISHING", "PUBLISHED"] } },
          { publishedExternalId: { not: null } },
        ],
      },
    }),
    prisma.projectSocialConnectionAudit.count({
      where: {
        projectSocialConnection: { projectId },
        providerOutcome: "revoked",
      },
    }),
  ]);
  const liveCuso = liveCusos > 0;
  return {
    projectId,
    sourceProjectId: project.sourceProjectId,
    tornDownAt: project.testCopyTornDownAt,
    clean:
      unsentPosts === 0 &&
      linkedAccounts === 0 &&
      activeTurns === 0 &&
      !liveCuso,
    left: { unsentPosts, linkedAccounts, activeTurns, liveCuso },
    publishedPosts,
    providerRevocations,
  };
}

/**
 * Tears a test copy down: archives its Cuso (which ends what he was doing and
 * writes off his Tester credits), stops his other runs, cancels every post
 * that has not gone out and disconnects the links, without asking a provider
 * for anything. Running it again removes nothing and answers the same check.
 */
export async function tearDownTestCopy(
  projectId: string,
): Promise<TestCopyTeardown> {
  const project = await requireTestCopyProject(projectId);
  const cusos = await prisma.sokoBot.findMany({
    where: { ...LIVE_CUSO_WHERE, projectId },
    select: { id: true },
  });
  if (cusos.length > 0) {
    // Archiving a shared bot is an owner's or admin's act; the teardown
    // archives in the name of the organization's longest-standing one.
    const manager = await prisma.member.findFirst({
      where: {
        organizationId: project.workspace.organizationId ?? "",
        role: { in: [MemberRole.OWNER, MemberRole.ADMIN] },
      },
      orderBy: { createdAt: "asc" },
      select: { userId: true },
    });
    if (!manager) throw new Error("A test copy's organization has no owner");
    const { sokoBotControlPlane } = await import(
      "@/services/soko-bot-control-plane.service"
    );
    for (const cuso of cusos) {
      await sokoBotControlPlane.archive(manager.userId, project.workspaceId, {
        kind: "id",
        sokoBotId: cuso.id,
      });
    }
  }

  const now = new Date();
  const removed = await prisma.$transaction(async (tx) => {
    // Archiving ends the turn in the chat; his background runs end here.
    const queued = await tx.sokoBotTurn.updateMany({
      where: { sokoBot: { projectId }, status: "QUEUED" },
      data: { status: "CANCELLED" },
    });
    const running = await tx.sokoBotTurn.updateMany({
      where: {
        sokoBot: { projectId },
        status: { in: ["STARTING", "RUNNING"] },
      },
      data: { status: "CANCEL_REQUESTED", cancellationRequestedAt: now },
    });
    const posts = await tx.socialPost.findMany({
      where: { projectId, status: { in: [...UNSENT_POST_STATUSES] } },
      select: { id: true },
    });
    await tx.socialPost.updateMany({
      where: { id: { in: posts.map((post) => post.id) } },
      data: {
        status: "CANCELED",
        canceledAt: now,
        revision: { increment: 1 },
      },
    });
    for (const post of posts) {
      await flagSocialPostQuotes(post.id, QUOTED_POST_CANCELLED, tx);
    }
    const links = await tx.projectSocialConnection.findMany({
      where: { projectId, status: { not: "disconnected" } },
    });
    await tx.projectSocialConnection.updateMany({
      where: { id: { in: links.map((link) => link.id) } },
      data: {
        status: "disconnected",
        activeExternalAccountKey: null,
        disconnectedAt: now,
      },
    });
    // The audit's outcome is final, so nothing later retries a revocation.
    await tx.projectSocialConnectionAudit.createMany({
      data: links.map((link) => ({
        projectSocialConnectionId: link.id,
        action: "test_copy_unlink",
        actorId: "test-copy-teardown",
        externalAccountId: link.externalAccountId,
        externalHandle: link.externalHandle,
        connectedAccountId: link.composioConnectedAccountId,
        providerOutcome: "revocation_skipped_shared",
      })),
    });
    await tx.project.updateMany({
      where: { id: projectId, testCopyTornDownAt: null },
      data: { testCopyTornDownAt: now },
    });
    return {
      canceledPosts: posts.length,
      unlinkedAccounts: links.length,
      stoppedTurns: queued.count + running.count,
      archivedCuso: cusos.length > 0,
    };
  });
  return { removed, check: await checkTestCopy(projectId) };
}

/** Whether this member may tear the copy down: an owner or admin, or whoever made it. */
async function requireTestCopyManager(target: CusoTarget): Promise<void> {
  const { organizationId } = await requireProjectAccessForUser(target);
  const member = await prisma.member.findFirst({
    where: { userId: target.userId, organizationId: organizationId ?? "" },
    select: { role: true },
  });
  if (
    (member !== null && isOrganizationOwnerOrAdmin(member.role)) ||
    (await madeTestCopy(target.userId, target.projectId))
  ) {
    return;
  }
  throw new CmoForbiddenError(
    "Only an organization owner or admin, or whoever made the test copy, tears it down",
  );
}

/** The teardown a member asks for (and Start over on a test copy). */
export async function tearDownTestCopyFor(
  target: CusoTarget,
): Promise<TestCopyTeardown> {
  await requireTestCopyManager(target);
  return tearDownTestCopy(target.projectId);
}

/** The check a member of the copy's organization reads. */
export async function checkTestCopyFor(
  target: CusoTarget,
): Promise<TestCopyCheck> {
  await requireProjectAccessForUser(target);
  return checkTestCopy(target.projectId);
}

/**
 * Tears down every test copy older than it may live. Runs with the CMO
 * production sync, every ten minutes, so no copy outlives its posts' floor.
 */
export async function tearDownExpiredTestCopies(
  shouldContinue: () => boolean = () => true,
): Promise<{ tornDown: number; failed: number }> {
  const expired = await prisma.project.findMany({
    where: {
      testCopyOfProjectId: { not: null },
      testCopyTornDownAt: null,
      createdAt: { lt: new Date(Date.now() - TEST_COPY_LIFETIME_MS) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  let tornDown = 0;
  let failed = 0;
  for (const { id } of expired) {
    if (!shouldContinue()) break;
    try {
      await tearDownTestCopy(id);
      tornDown += 1;
    } catch (error) {
      failed += 1;
      recordCoreWarning(
        { operation: "cmo_test_copy_teardown", project: { id } },
        {
          message: "Could not tear down an expired CMO test copy",
          why: "The teardown threw",
          fix: "Its posts are held by the publisher and never go out. The next CMO production sync tries again; if it repeats, look up the error name and code under failure.",
        },
        { failure: messageSafeErrorFields(error) },
      );
    }
  }
  return { tornDown, failed };
}
