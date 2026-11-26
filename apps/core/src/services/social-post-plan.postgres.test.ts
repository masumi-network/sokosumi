/**
 * Real-Postgres proof of the Social seams an owner's mid-month change uses
 * (design v5, part 2): a calendar entry's post made once per op, and a
 * post's plan written again, revision-checked, with its words sent back for
 * a rewrite.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/social-post-plan.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// Scheduling on X asks the provider for the account's tier; keep the stored one.
vi.mock("@/services/x-subscription-tier.service", () => ({
  resolveXSubscriptionType: async (connection: {
    subscriptionType: string | null;
  }) => connection.subscriptionType,
}));

import prisma from "@/lib/db/prisma";
import {
  createPlannedSocialPost,
  createSocialPost,
  planSocialPost,
} from "@/services/social-posts.service";
import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const seeded: { userId: string; organizationId: string }[] = [];

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const userId = `plan-user-${suffix}`;
  const organizationId = `plan-org-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: "Plan",
      email: `plan-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  seeded.push({ userId, organizationId });
  return withFixtureSchemas(async (tx) => {
    await tx.organization.create({
      data: {
        id: organizationId,
        name: "Plan Org",
        slug: organizationId,
        members: { create: { userId, role: "owner" } },
      },
    });
    const workspace = await tx.workspace.create({
      data: { organizationId },
      select: { id: true },
    });
    const project = await tx.project.create({
      data: { workspaceId: workspace.id, name: "Plan test" },
      select: { id: true },
    });
    const version = await tx.marketingStrategy.create({
      data: { projectId: project.id, plan: {} },
      select: { id: true },
    });
    const connection = await tx.projectSocialConnection.create({
      data: {
        projectId: project.id,
        provider: "x",
        externalAccountId: `x-${suffix}`,
        externalHandle: "acme",
        composioConnectedAccountId: `ca-${suffix}`,
        status: "active",
        activeExternalAccountKey: `x:x-${suffix}`,
        connectorUserId: "sokosumi:user:owner",
        connectedAt: new Date(),
      },
      select: { id: true },
    });
    return {
      scope: {
        projectId: project.id,
        workspaceId: workspace.id,
        userId,
        organizationId,
      },
      versionId: version.id,
      socialConnectionId: connection.id,
    };
  });
}

afterEach(async () => {
  if (!enabled) return;
  for (const row of seeded.splice(0)) {
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: row.organizationId },
      select: { id: true },
    });
    const ids = workspaces.map((workspace) => workspace.id);
    await withFixtureSchemas(async (tx) => {
      await tx.socialPost.deleteMany({ where: { workspaceId: { in: ids } } });
      await tx.projectSocialConnection.deleteMany({
        where: { project: { workspaceId: { in: ids } } },
      });
      await tx.marketingStrategy.deleteMany({
        where: { project: { workspaceId: { in: ids } } },
      });
      await tx.project.deleteMany({ where: { workspaceId: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: ids } } });
      await tx.organization.deleteMany({ where: { id: row.organizationId } });
    });
    await prisma.user.deleteMany({ where: { id: row.userId } });
  }
});

const planning = {
  id: "entry-1",
  title: "Launch week",
  format: "post",
  brief: "Why now",
};

describe.runIf(enabled)("an owner's change on Social posts", () => {
  it("makes an entry's post once per op, as a draft at its planned time", async () => {
    const world = await seed();
    const plannedAt = new Date(Date.now() + 4 * 86_400_000);
    const input = {
      ...world.scope,
      marketingStrategyId: world.versionId,
      provider: "x",
      socialConnectionId: world.socialConnectionId,
      plannedAt,
      timezone: "UTC",
      planning,
      applyOpId: "op-create-1",
    };
    const made = await createPlannedSocialPost(input);
    const again = await createPlannedSocialPost(input);
    expect(again.id).toBe(made.id);
    const rows = await prisma.socialPost.findMany({
      where: { projectId: world.scope.projectId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "DRAFT",
      marketingStrategyId: world.versionId,
      socialConnectionId: world.socialConnectionId,
      creatorUserId: world.scope.userId,
    });
    expect(rows[0].scheduledAt?.toISOString()).toBe(plannedAt.toISOString());
    expect(rows[0].planning).toMatchObject({
      ...planning,
      applyOpId: "op-create-1",
    });
  });

  it("refuses a connection on another network", async () => {
    const world = await seed();
    await expect(
      createPlannedSocialPost({
        ...world.scope,
        marketingStrategyId: world.versionId,
        provider: "linkedin",
        socialConnectionId: world.socialConnectionId,
        plannedAt: new Date(Date.now() + 86_400_000),
        timezone: "UTC",
        planning,
        applyOpId: "op-create-2",
      }),
    ).rejects.toThrow("another network");
  });

  it("writes a plan revision-checked, and sends a written post back for its words", async () => {
    const world = await seed();
    const at = new Date(Date.now() + 3 * 86_400_000);
    const post = await createSocialPost({
      ...world.scope,
      socialConnectionId: world.socialConnectionId,
      text: "The words the owner liked",
      scheduledAt: at,
      timezone: "UTC",
    });
    expect(post.status).toBe("SCHEDULED");
    await expect(
      planSocialPost({
        ...world.scope,
        postId: post.id,
        revision: post.revision + 1,
        planning,
        applyOpId: "op-plan-1",
      }),
    ).rejects.toThrow();
    const kept = await planSocialPost({
      ...world.scope,
      postId: post.id,
      revision: post.revision,
      planning,
      applyOpId: "op-plan-1",
    });
    expect(kept.status).toBe("SCHEDULED");
    expect(kept.text).toBe("The words the owner liked");
    const rewrite = await planSocialPost({
      ...world.scope,
      postId: post.id,
      revision: kept.revision,
      planning: { ...planning, title: "Launch day" },
      applyOpId: "op-plan-2",
      rewrite: true,
    });
    expect(rewrite.status).toBe("DRAFT");
    expect(rewrite.text).toBe("Why now");
    const row = await prisma.socialPost.findUniqueOrThrow({
      where: { id: post.id },
    });
    expect(row.scheduledAt?.toISOString()).toBe(at.toISOString());
    expect(row.planning).toMatchObject({
      title: "Launch day",
      applyOpId: "op-plan-2",
    });
  });

  const planned = (
    world: Awaited<ReturnType<typeof seed>>,
    applyOpId: string,
    plan: Parameters<typeof createPlannedSocialPost>[0]["planning"] = planning,
  ) =>
    createPlannedSocialPost({
      ...world.scope,
      marketingStrategyId: world.versionId,
      provider: "x",
      socialConnectionId: world.socialConnectionId,
      plannedAt: new Date(Date.now() + 4 * 86_400_000),
      timezone: "UTC",
      planning: plan,
      applyOpId,
    });

  it("finds the post an op made after a later op planned it again (Codex)", async () => {
    const world = await seed();
    const made = await planned(world, "op-create");
    await planSocialPost({
      ...world.scope,
      postId: made.id,
      revision: made.revision,
      planning: { ...planning, title: "Launch day" },
      applyOpId: "op-edit",
    });
    const again = await planned(world, "op-create");
    expect(again.id).toBe(made.id);
    expect(
      await prisma.socialPost.count({
        where: { projectId: world.scope.projectId },
      }),
    ).toBe(1);
    const row = await prisma.socialPost.findUniqueOrThrow({
      where: { id: made.id },
    });
    expect(row.planning).toMatchObject({
      title: "Launch day",
      applyOpId: "op-edit",
      applyCreateOpId: "op-create",
    });
  });

  it("moves an unwritten post's placeholder with its plan, never keeps the old brief as words (Codex)", async () => {
    const world = await seed();
    const made = await planned(world, "op-create");
    expect(made.text).toBe("Why now");
    const replanned = await planSocialPost({
      ...world.scope,
      postId: made.id,
      revision: made.revision,
      planning: { ...planning, brief: "Launch checklist" },
      applyOpId: "op-edit",
    });
    expect(replanned.text).toBe("Launch checklist");
    expect(replanned.status).toBe("DRAFT");
  });

  it("drops a talking video's recording and its copies' when its script changes, keeps it otherwise (Codex)", async () => {
    const world = await seed();
    const video = {
      pathname: "drive/users/plan/talk.mp4",
      fileUrl: "https://example.test/talk.mp4",
      name: "talk.mp4",
      size: 1000,
      mimeType: "video/mp4",
      kind: "video" as const,
    };
    const talking = {
      ...planning,
      format: "talking_video",
      script: "Start a one-week trial",
      presenter: "Ava",
    };
    const made = await planned(world, "op-create", talking);
    const copy = await planned(world, "op-copy", {
      ...talking,
      id: "entry-1-linkedin",
      videoOf: "entry-1",
    });
    await prisma.socialPost.updateMany({
      where: { id: { in: [made.id, copy.id] } },
      data: { media: [video], text: "Our trial, in a minute" },
    });
    const withVideo = await prisma.socialPost.findUniqueOrThrow({
      where: { id: made.id },
    });
    const retitled = await planSocialPost({
      ...world.scope,
      postId: made.id,
      revision: withVideo.revision,
      planning: { ...talking, title: "Trial week" },
      applyOpId: "op-title",
    });
    expect(retitled.media).toHaveLength(1);
    expect(retitled.text).toBe("Our trial, in a minute");
    const rescripted = await planSocialPost({
      ...world.scope,
      postId: made.id,
      revision: retitled.revision,
      planning: { ...talking, script: "Start a one-month trial" },
      applyOpId: "op-script",
    });
    expect(rescripted.media).toHaveLength(0);
    expect(rescripted.status).toBe("DRAFT");
    const copied = await prisma.socialPost.findUniqueOrThrow({
      where: { id: copy.id },
    });
    expect(copied.media).toEqual([]);
    expect(copied.planning).toMatchObject({
      videoOf: "entry-1",
      script: "Start a one-month trial",
    });
  });

  it("changes only its own month's copies when a script changes (Codex)", async () => {
    const world = await seed();
    const video = {
      pathname: "drive/users/plan/talk.mp4",
      fileUrl: "https://example.test/talk.mp4",
      name: "talk.mp4",
      size: 1000,
      mimeType: "video/mp4",
      kind: "video" as const,
    };
    const talking = {
      ...planning,
      format: "talking_video",
      script: "Start a one-week trial",
    };
    const otherMonth = await withFixtureSchemas((tx) =>
      tx.marketingStrategy.create({
        data: { projectId: world.scope.projectId, plan: {} },
        select: { id: true },
      }),
    );
    const made = await planned(world, "op-create", talking);
    // Last month's copy of an entry with the same id, scheduled with its video.
    const lastMonthCopy = await planned(
      { ...world, versionId: otherMonth.id },
      "op-old-copy",
      { ...talking, id: "entry-1-linkedin", videoOf: "entry-1" },
    );
    await prisma.socialPost.updateMany({
      where: { id: { in: [made.id, lastMonthCopy.id] } },
      data: { media: [video], text: "Our trial, in a minute" },
    });
    await prisma.socialPost.update({
      where: { id: lastMonthCopy.id },
      data: { status: "SCHEDULED" },
    });
    const before = await prisma.socialPost.findUniqueOrThrow({
      where: { id: lastMonthCopy.id },
    });
    const current = await prisma.socialPost.findUniqueOrThrow({
      where: { id: made.id },
    });
    const rescripted = await planSocialPost({
      ...world.scope,
      postId: made.id,
      revision: current.revision,
      planning: { ...talking, script: "Start a one-month trial" },
      applyOpId: "op-script",
    });
    expect(rescripted.media).toHaveLength(0);
    const after = await prisma.socialPost.findUniqueOrThrow({
      where: { id: lastMonthCopy.id },
    });
    expect(after.status).toBe("SCHEDULED");
    expect(after.media).toEqual(before.media);
    expect(after.revision).toBe(before.revision);
    expect(after.planning).toMatchObject({ script: "Start a one-week trial" });
  });

  it("never plans a post that went out", async () => {
    const world = await seed();
    const post = await createSocialPost({
      ...world.scope,
      socialConnectionId: world.socialConnectionId,
      text: "Out already",
    });
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED" },
    });
    const published = await prisma.socialPost.findUniqueOrThrow({
      where: { id: post.id },
    });
    await expect(
      planSocialPost({
        ...world.scope,
        postId: post.id,
        revision: published.revision,
        planning,
        applyOpId: "op-plan-3",
      }),
    ).rejects.toThrow("has not gone out");
  });
});
