/**
 * Real-Postgres proof of a CMO test copy (ADR 0073): its Social connections
 * are links to the source's connected accounts, the source's rows are never
 * written, a link never ends an account at the provider, and only the
 * source's own organization gets a copy.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-test-copy.postgres.test.ts
 *
 * The rules are relational filters and row writes across two Projects, so
 * mocked Prisma cannot show them. Fixtures are committed and deleted after
 * each test; the providers are mocked, and a test fails if one is called.
 */
import { randomUUID } from "node:crypto";
import { CMO_SOKO_BOT_VERSION_IDS } from "@sokosumi/soko-bot";
import { afterEach, describe, expect, it, vi } from "vitest";

const TESTER_EMAIL = vi.hoisted(() => {
  const email = "tester@test-copy.example.test";
  process.env.CMO_SUBSCRIPTION_SKIP_ALLOWLIST = email;
  return email;
});

const provider = vi.hoisted(() => ({
  revokeComposio: vi.fn(),
  deleteZernioProfile: vi.fn(),
}));

vi.mock("@/clients/composio.client", async (original) => ({
  ...(await original<typeof import("@/clients/composio.client")>()),
  revokeComposioConnectedAccount: provider.revokeComposio,
}));
// Scheduling on X asks the provider for the account's tier; keep the stored one.
vi.mock("@/services/x-subscription-tier.service", () => ({
  resolveXSubscriptionType: async (connection: {
    subscriptionType: string | null;
  }) => connection.subscriptionType,
}));
vi.mock("./zernio-tiktok-connection.service", async (original) => ({
  ...(await original<typeof import("./zernio-tiktok-connection.service")>()),
  deleteZernioProfile: provider.deleteZernioProfile,
}));

import prisma from "@/lib/db/prisma";
import {
  CmoConflictError,
  CmoForbiddenError,
} from "@/services/cmo-cuso.service";
import {
  checkTestCopy,
  checkTestCopyFor,
  linkTestCopyConnections,
  requireTestCopySource,
  tearDownExpiredTestCopies,
  tearDownTestCopy,
  tearDownTestCopyFor,
  testCopySourceBotId,
} from "@/services/cmo-test-copy.service";
import { mayApproveMarketingStrategy } from "@/services/marketing-strategy.service";
import {
  connectionExecutorUserId,
  disconnectProjectSocialConnection,
  initiateProjectSocialConnection,
  projectExecutorUserId,
} from "@/services/project-social-connections.service";
import {
  madeTestCopy,
  TEST_COPY_LIFETIME_MS,
  TEST_COPY_SCHEDULE_FLOOR_MESSAGE,
} from "@/services/project-test-copy";
import {
  publishDueSocialPosts,
  publishSocialPostNow,
  TEST_COPY_NEVER_PUBLISHES,
} from "@/services/social-post-publisher.service";
import {
  createSocialPost,
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

interface Organization {
  organizationId: string;
  workspaceId: string;
  ownerId: string;
}

const organizations: Organization[] = [];
const users: string[] = [];

async function seedUser(email?: string): Promise<string> {
  const id = `test-copy-user-${randomUUID().slice(0, 8)}`;
  await prisma.user.create({
    data: {
      id,
      name: "Test Copy",
      email: email ?? `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  users.push(id);
  return id;
}

async function seedOrganization(): Promise<Organization> {
  const ownerId = await seedUser();
  const organizationId = `test-copy-org-${randomUUID().slice(0, 8)}`;
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "Test Copy Org",
      slug: organizationId,
      members: { create: { userId: ownerId, role: "owner" } },
    },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId },
    select: { id: true },
  });
  const row = { organizationId, workspaceId: workspace.id, ownerId };
  organizations.push(row);
  return row;
}

async function seedMember(organizationId: string, email?: string) {
  const userId = await seedUser(email);
  await prisma.member.create({
    data: {
      id: randomUUID(),
      userId,
      organizationId,
      role: "member",
      createdAt: new Date(),
    },
  });
  return userId;
}

/** A hired Cuso; `testCopyOf` makes his Project a test copy of that one. */
async function seedCuso(
  organization: Organization,
  options: { testCopyOf?: string; hiredBy?: string } = {},
) {
  const project = await prisma.project.create({
    data: {
      workspaceId: organization.workspaceId,
      name: "acme.io",
      websiteUrl: "https://www.acme.io",
      testCopyOfProjectId: options.testCopyOf ?? null,
    },
    select: { id: true },
  });
  const bot = await prisma.sokoBot.create({
    data: {
      workspaceId: organization.workspaceId,
      projectId: project.id,
      userId: null,
      createdByUserId: options.hiredBy ?? organization.ownerId,
      versionId: CMO_SOKO_BOT_VERSION_IDS[0],
      name: "Cuso",
    },
    select: { id: true },
  });
  return { projectId: project.id, sokoBotId: bot.id };
}

async function seedConnection(
  projectId: string,
  provider: string,
  account: { connectedAccountId: string; zernioProfileId?: string },
) {
  return prisma.projectSocialConnection.create({
    data: {
      projectId,
      provider,
      externalAccountId: `${provider}-account`,
      externalHandle: "acme",
      composioConnectedAccountId: account.connectedAccountId,
      zernioProfileId: account.zernioProfileId ?? null,
      status: "active",
      activeExternalAccountKey: `${provider}:${provider}-account`,
      connectorUserId: "sokosumi:user:owner",
      connectedAt: new Date(),
    },
  });
}

/** A source Cuso with X and TikTok connected, and a linked test copy. */
async function seedSourceAndCopy() {
  const organization = await seedOrganization();
  const source = await seedCuso(organization);
  await seedConnection(source.projectId, "x", { connectedAccountId: "ca_x" });
  await seedConnection(source.projectId, "tiktok", {
    connectedAccountId: "zernio:0123456789abcdef01234567",
    zernioProfileId: "abcdef0123456789abcdef01",
  });
  const copy = await seedCuso(organization, { testCopyOf: source.projectId });
  await linkTestCopyConnections({
    projectId: copy.projectId,
    sourceProjectId: source.projectId,
    actorId: organization.ownerId,
  });
  return { organization, source, copy };
}

function connectionsOf(projectId: string) {
  return prisma.projectSocialConnection.findMany({
    where: { projectId },
    orderBy: { provider: "asc" },
  });
}

describe.skipIf(!enabled)("CMO test copy against PostgreSQL", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    for (const { organizationId, workspaceId } of organizations.splice(0)) {
      await prisma.socialPost.deleteMany({ where: { workspaceId } });
      await prisma.sokoBotTurn.deleteMany({ where: { workspaceId } });
      await prisma.sokoBot.deleteMany({ where: { workspaceId } });
      await prisma.project.deleteMany({ where: { workspaceId } });
      await prisma.workspace.deleteMany({ where: { id: workspaceId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: users.splice(0) } } });
  });

  it("links the source's accounts to the copy without touching the source", async () => {
    const organization = await seedOrganization();
    const source = await seedCuso(organization);
    await seedConnection(source.projectId, "x", { connectedAccountId: "ca_x" });
    await seedConnection(source.projectId, "tiktok", {
      connectedAccountId: "zernio:0123456789abcdef01234567",
      zernioProfileId: "abcdef0123456789abcdef01",
    });
    const before = await connectionsOf(source.projectId);
    const copy = await seedCuso(organization, { testCopyOf: source.projectId });

    const linked = await linkTestCopyConnections({
      projectId: copy.projectId,
      sourceProjectId: source.projectId,
      actorId: organization.ownerId,
    });

    expect(linked).toBe(2);
    expect(await connectionsOf(source.projectId)).toEqual(before);
    const links = await connectionsOf(copy.projectId);
    expect(
      links.map((link) => ({
        provider: link.provider,
        account: link.composioConnectedAccountId,
        executor: link.executorProjectId,
        zernioProfileId: link.zernioProfileId,
        status: link.status,
      })),
    ).toEqual([
      {
        provider: "tiktok",
        account: "zernio:0123456789abcdef01234567",
        executor: source.projectId,
        zernioProfileId: null,
        status: "active",
      },
      {
        provider: "x",
        account: "ca_x",
        executor: source.projectId,
        zernioProfileId: null,
        status: "active",
      },
    ]);
    // The link runs tools as the Project the account was granted to.
    for (const link of links) {
      expect(connectionExecutorUserId(link)).toBe(
        projectExecutorUserId(source.projectId),
      );
    }
  });

  it("never ends an account at the provider when a link is disconnected", async () => {
    const { organization, source, copy } = await seedSourceAndCopy();
    // Even with the source's own rows gone, a link is not the account's owner.
    await prisma.projectSocialConnection.updateMany({
      where: { projectId: source.projectId },
      data: { status: "disconnected", activeExternalAccountKey: null },
    });

    for (const link of await connectionsOf(copy.projectId)) {
      const result = await disconnectProjectSocialConnection({
        projectId: copy.projectId,
        workspaceId: organization.workspaceId,
        userId: organization.ownerId,
        socialConnectionId: link.id,
      });
      expect(result.providerRevocation).toBe("skipped");
    }

    expect(provider.revokeComposio).not.toHaveBeenCalled();
    expect(provider.deleteZernioProfile).not.toHaveBeenCalled();
    expect(
      (await connectionsOf(copy.projectId)).map((link) => link.status),
    ).toEqual(["disconnected", "disconnected"]);
  });

  it("holds a test copy's due post and refuses to publish it now", async () => {
    const { organization, copy } = await seedSourceAndCopy();
    const [link] = await connectionsOf(copy.projectId);
    if (!link) throw new Error("The copy has no link");
    const post = await prisma.socialPost.create({
      data: {
        projectId: copy.projectId,
        workspaceId: organization.workspaceId,
        socialConnectionId: link.id,
        provider: link.provider,
        text: "A due post of a test copy",
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() - 60_000),
        creatorUserId: organization.ownerId,
      },
    });

    const run = await publishDueSocialPosts({
      shouldContinue: () => true,
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
    });

    expect(run).toMatchObject({ claimed: 0, published: 0 });
    await expect(
      publishSocialPostNow({
        projectId: copy.projectId,
        workspaceId: organization.workspaceId,
        userId: organization.ownerId,
        postId: post.id,
        revision: post.revision,
      }),
    ).rejects.toThrow(TEST_COPY_NEVER_PUBLISHES);
    expect(
      await prisma.socialPost.findUnique({
        where: { id: post.id },
        select: { status: true, attemptCount: true, publishedAt: true },
      }),
    ).toEqual({ status: "SCHEDULED", attemptCount: 0, publishedAt: null });
  });

  it("schedules a test copy's post 12 hours ahead or later, never sooner", async () => {
    const { organization, source, copy } = await seedSourceAndCopy();
    const onX = async (projectId: string) =>
      (await connectionsOf(projectId)).find((row) => row.provider === "x");
    const link = await onX(copy.projectId);
    const own = await onX(source.projectId);
    if (!link || !own) throw new Error("Missing connections");
    const hours = (count: number) =>
      new Date(Date.now() + count * 60 * 60 * 1_000);
    const draft = (projectId: string, socialConnectionId: string) =>
      createSocialPost({
        projectId,
        workspaceId: organization.workspaceId,
        userId: organization.ownerId,
        organizationId: organization.organizationId,
        socialConnectionId,
        text: "A post to schedule",
      });
    const schedule = (
      projectId: string,
      post: { id: string; revision: number },
      scheduledAt: Date,
    ) =>
      scheduleSocialPost({
        projectId,
        workspaceId: organization.workspaceId,
        userId: organization.ownerId,
        organizationId: organization.organizationId,
        postId: post.id,
        revision: post.revision,
        scheduledAt,
        timezone: "UTC",
      });

    const copied = await draft(copy.projectId, link.id);
    await expect(schedule(copy.projectId, copied, hours(11))).rejects.toThrow(
      TEST_COPY_SCHEDULE_FLOOR_MESSAGE,
    );
    const scheduled = await schedule(copy.projectId, copied, hours(13));
    expect(scheduled.status).toBe("SCHEDULED");
    // Moving it closer is refused too.
    await expect(
      updateSocialPost({
        projectId: copy.projectId,
        workspaceId: organization.workspaceId,
        userId: organization.ownerId,
        organizationId: organization.organizationId,
        postId: scheduled.id,
        revision: scheduled.revision,
        scheduledAt: hours(1),
      }),
    ).rejects.toThrow(TEST_COPY_SCHEDULE_FLOOR_MESSAGE);

    // The source schedules as it always did.
    const real = await draft(source.projectId, own.id);
    expect((await schedule(source.projectId, real, hours(1))).status).toBe(
      "SCHEDULED",
    );
  });

  /** A copy at work: two unsent posts, one canceled before, a queued run. */
  async function seedCopyAtWork() {
    const seeded = await seedSourceAndCopy();
    const { organization, copy } = seeded;
    const [link] = await connectionsOf(copy.projectId);
    const post = (status: "SCHEDULED" | "DRAFT" | "CANCELED") =>
      prisma.socialPost.create({
        data: {
          projectId: copy.projectId,
          workspaceId: organization.workspaceId,
          socialConnectionId: link?.id ?? null,
          provider: "x",
          text: `A ${status} post`,
          status,
          scheduledAt: new Date(Date.now() + 13 * 60 * 60 * 1_000),
          creatorUserId: organization.ownerId,
        },
      });
    await post("SCHEDULED");
    await post("DRAFT");
    await post("CANCELED");
    await prisma.sokoBotTurn.create({
      data: {
        sokoBotId: copy.sokoBotId,
        workspaceId: organization.workspaceId,
        source: "SCHEDULE",
        clientTurnId: `test-copy-${randomUUID()}`,
        requestedByUserId: organization.ownerId,
        userMessage: "Make the month",
        capabilityNames: [],
        status: "QUEUED",
        deadlineAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    return seeded;
  }

  it("tears a copy down in one call, leaves nothing, and never touches the source", async () => {
    const { source, copy } = await seedCopyAtWork();
    const sourceBefore = await connectionsOf(source.projectId);

    const first = await tearDownTestCopy(copy.projectId);

    expect(first.removed).toEqual({
      canceledPosts: 2,
      unlinkedAccounts: 2,
      stoppedTurns: 1,
      archivedCuso: true,
    });
    expect(first.check).toMatchObject({
      clean: true,
      left: {
        unsentPosts: 0,
        linkedAccounts: 0,
        activeTurns: 0,
        liveCuso: false,
      },
      publishedPosts: 0,
      providerRevocations: 0,
      sourceProjectId: source.projectId,
    });
    expect(first.check.tornDownAt).toBeInstanceOf(Date);
    // The source keeps its accounts and its Cuso, and no provider was asked.
    expect(await connectionsOf(source.projectId)).toEqual(sourceBefore);
    expect(
      await prisma.sokoBot.findUnique({
        where: { id: source.sokoBotId },
        select: { archivedAt: true },
      }),
    ).toEqual({ archivedAt: null });
    expect(provider.revokeComposio).not.toHaveBeenCalled();
    expect(provider.deleteZernioProfile).not.toHaveBeenCalled();
    expect(
      await prisma.socialPost.groupBy({
        by: ["status"],
        where: { projectId: copy.projectId },
        _count: true,
      }),
    ).toEqual([{ status: "CANCELED", _count: 3 }]);

    // Again: nothing more to remove, the same answer.
    const second = await tearDownTestCopy(copy.projectId);
    expect(second.removed).toEqual({
      canceledPosts: 0,
      unlinkedAccounts: 0,
      stoppedTurns: 0,
      archivedCuso: false,
    });
    expect(second.check).toEqual(first.check);
  });

  it("tears down by itself a copy older than six hours, and no younger one", async () => {
    const old = await seedCopyAtWork();
    const young = await seedCopyAtWork();
    await prisma.project.update({
      where: { id: old.copy.projectId },
      data: { createdAt: new Date(Date.now() - TEST_COPY_LIFETIME_MS - 1_000) },
    });

    // Other suites may leave expired copies in a shared database.
    expect((await tearDownExpiredTestCopies()).tornDown).toBeGreaterThan(0);

    expect((await checkTestCopy(old.copy.projectId)).clean).toBe(true);
    expect(await checkTestCopy(young.copy.projectId)).toMatchObject({
      clean: false,
      tornDownAt: null,
      left: { unsentPosts: 2, linkedAccounts: 2, liveCuso: true },
    });
  });

  it("lets an owner or whoever made the copy tear it down, no other member", async () => {
    const organization = await seedOrganization();
    const source = await seedCuso(organization);
    const tester = await seedMember(organization.organizationId, TESTER_EMAIL);
    const member = await seedMember(organization.organizationId);
    const copy = await seedCuso(organization, {
      testCopyOf: source.projectId,
      hiredBy: tester,
    });

    await expect(
      tearDownTestCopyFor({ userId: member, projectId: copy.projectId }),
    ).rejects.toBeInstanceOf(CmoForbiddenError);
    // A real Cuso's Project is not a test copy, whoever asks.
    await expect(
      tearDownTestCopyFor({
        userId: organization.ownerId,
        projectId: source.projectId,
      }),
    ).rejects.toThrow("That Project is not a test copy");
    // The member may still read what is left.
    expect(
      (await checkTestCopyFor({ userId: member, projectId: copy.projectId }))
        .clean,
    ).toBe(false);

    const report = await tearDownTestCopyFor({
      userId: tester,
      projectId: copy.projectId,
    });
    expect(report.check.clean).toBe(true);
  });

  it("refuses a new sign-in on a test copy", async () => {
    const { organization, copy } = await seedSourceAndCopy();

    await expect(
      initiateProjectSocialConnection({
        projectId: copy.projectId,
        workspaceId: organization.workspaceId,
        userId: organization.ownerId,
        action: "connect",
        provider: "x",
      }),
    ).rejects.toThrow("A test copy uses the accounts of the Cuso it copies");
  });

  it("lets an owner and a tester of the source's organization make a copy, nobody else", async () => {
    const organization = await seedOrganization();
    const source = await seedCuso(organization);
    const member = await seedMember(organization.organizationId);
    const tester = await seedMember(organization.organizationId, TESTER_EMAIL);
    const target = {
      sourceProjectId: source.projectId,
      organizationId: organization.organizationId,
    };

    await expect(
      requireTestCopySource({ userId: organization.ownerId, ...target }),
    ).resolves.toBe(organization.organizationId);
    // Without a named organization the copy still goes into the source's.
    await expect(
      requireTestCopySource({
        userId: tester,
        sourceProjectId: source.projectId,
        organizationId: undefined,
      }),
    ).resolves.toBe(organization.organizationId);
    await expect(
      requireTestCopySource({ userId: member, ...target }),
    ).rejects.toBeInstanceOf(CmoForbiddenError);
  });

  it("refuses a copy into another organization, and a copy of a copy", async () => {
    const { organization, source, copy } = await seedSourceAndCopy();
    const other = await seedOrganization();
    await prisma.member.create({
      data: {
        id: randomUUID(),
        userId: organization.ownerId,
        organizationId: other.organizationId,
        role: "owner",
        createdAt: new Date(),
      },
    });

    await expect(
      requireTestCopySource({
        userId: organization.ownerId,
        sourceProjectId: source.projectId,
        organizationId: other.organizationId,
      }),
    ).rejects.toBeInstanceOf(CmoForbiddenError);
    // An outsider cannot even see the source.
    await expect(
      requireTestCopySource({
        userId: other.ownerId,
        sourceProjectId: source.projectId,
        organizationId: other.organizationId,
      }),
    ).rejects.toThrow("Project not found");
    await expect(
      requireTestCopySource({
        userId: organization.ownerId,
        sourceProjectId: copy.projectId,
        organizationId: organization.organizationId,
      }),
    ).rejects.toBeInstanceOf(CmoConflictError);
  });

  it("lets the member who made a copy approve its strategy, and only its", async () => {
    const organization = await seedOrganization();
    const source = await seedCuso(organization);
    const tester = await seedMember(organization.organizationId, TESTER_EMAIL);
    const copy = await seedCuso(organization, {
      testCopyOf: source.projectId,
      hiredBy: tester,
    });
    const workspace = {
      id: organization.workspaceId,
      userId: null,
      organizationId: organization.organizationId,
    };

    expect(await madeTestCopy(tester, copy.projectId)).toBe(true);
    expect(
      await mayApproveMarketingStrategy(
        tester,
        workspace,
        prisma,
        copy.projectId,
      ),
    ).toBe(true);
    expect(
      await mayApproveMarketingStrategy(
        tester,
        workspace,
        prisma,
        source.projectId,
      ),
    ).toBe(false);
  });

  it("reads measurement through the source's Cuso while he is live", async () => {
    const { source, copy } = await seedSourceAndCopy();

    expect(await testCopySourceBotId(copy.sokoBotId)).toBe(source.sokoBotId);
    expect(await testCopySourceBotId(source.sokoBotId)).toBeNull();

    await prisma.sokoBot.update({
      where: { id: source.sokoBotId },
      data: { archivedAt: new Date() },
    });
    expect(await testCopySourceBotId(copy.sokoBotId)).toBeNull();
  });
});
