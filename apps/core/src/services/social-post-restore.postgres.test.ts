/**
 * Real-Postgres proof that a cancel can be taken back (cmo-v25, design v5):
 * an owner's change that cancelled a scheduled post is undone, so the post
 * is scheduled again at its time through Social's own checks, and the post
 * quoting it loses the flag the cancel set.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/social-post-restore.postgres.test.ts
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
  cancelSocialPost,
  createSocialPost,
  restoreCanceledSocialPost,
  scheduleSocialPost,
} from "@/services/social-posts.service";
import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const seeded: { userId: string; organizationId: string }[] = [];

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const userId = `restore-user-${suffix}`;
  const organizationId = `restore-org-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: "Restore",
      email: `restore-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  seeded.push({ userId, organizationId });
  const { workspaceId, projectId } = await withFixtureSchemas(async (tx) => {
    await tx.organization.create({
      data: {
        id: organizationId,
        name: "Restore Org",
        slug: organizationId,
        members: { create: { userId, role: "owner" } },
      },
    });
    const workspace = await tx.workspace.create({
      data: { organizationId },
      select: { id: true },
    });
    const project = await tx.project.create({
      data: { workspaceId: workspace.id, name: "Restore test" },
      select: { id: true },
    });
    return { workspaceId: workspace.id, projectId: project.id };
  });
  const connection = await prisma.projectSocialConnection.create({
    data: {
      projectId,
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
  const scope = { projectId, workspaceId, userId, organizationId };
  return { scope, socialConnectionId: connection.id };
}

afterEach(async () => {
  if (!enabled) return;
  for (const row of seeded.splice(0)) {
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: row.organizationId },
      select: { id: true },
    });
    const ids = workspaces.map((workspace) => workspace.id);
    await prisma.socialPost.deleteMany({ where: { workspaceId: { in: ids } } });
    await prisma.projectSocialConnection.deleteMany({
      where: { project: { workspaceId: { in: ids } } },
    });
    await withFixtureSchemas(async (tx) => {
      await tx.project.deleteMany({ where: { workspaceId: { in: ids } } });
      await tx.workspace.deleteMany({ where: { id: { in: ids } } });
      await tx.organization.deleteMany({ where: { id: row.organizationId } });
    });
    await prisma.user.deleteMany({ where: { id: row.userId } });
  }
});

describe.runIf(enabled)("taking back a cancel", () => {
  it("schedules a cancelled post again at its time and clears its quote's flag", async () => {
    const { scope, socialConnectionId } = await seed();
    const at = new Date(Date.now() + 3 * 86_400_000);
    at.setUTCSeconds(0, 0);
    const draft = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "Launch day is Thursday",
    });
    const scheduled = await scheduleSocialPost({
      ...scope,
      postId: draft.id,
      revision: draft.revision,
      scheduledAt: at,
      timezone: "UTC",
    });
    const quote = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "More on this",
      quotedPostId: scheduled.id,
    });
    const canceled = await cancelSocialPost({
      ...scope,
      postId: scheduled.id,
      revision: scheduled.revision,
    });
    const flagged = await prisma.socialPost.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(flagged.needsAttentionReason).not.toBeNull();

    const restored = await restoreCanceledSocialPost({
      ...scope,
      postId: canceled.id,
      revision: canceled.revision,
      scheduledAt: at,
      timezone: "UTC",
      schedule: true,
    });
    expect(restored.status).toBe("SCHEDULED");
    const row = await prisma.socialPost.findUniqueOrThrow({
      where: { id: canceled.id },
    });
    expect(row.canceledAt).toBeNull();
    expect(row.scheduledAt?.toISOString()).toBe(at.toISOString());
    const quoting = await prisma.socialPost.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(quoting.needsAttentionReason).toBeNull();
  });

  it("refuses a stale revision and a post that is not cancelled", async () => {
    const { scope, socialConnectionId } = await seed();
    const draft = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "A draft",
    });
    await expect(
      restoreCanceledSocialPost({
        ...scope,
        postId: draft.id,
        revision: draft.revision,
        scheduledAt: null,
        schedule: false,
      }),
    ).rejects.toThrow("Only a canceled post can be restored");
    const canceled = await cancelSocialPost({
      ...scope,
      postId: draft.id,
      revision: draft.revision,
    });
    await expect(
      restoreCanceledSocialPost({
        ...scope,
        postId: canceled.id,
        revision: canceled.revision - 1,
        scheduledAt: null,
        schedule: false,
      }),
    ).rejects.toThrow();
    const back = await restoreCanceledSocialPost({
      ...scope,
      postId: canceled.id,
      revision: canceled.revision,
      scheduledAt: null,
      schedule: false,
    });
    expect(back.status).toBe("DRAFT");
  });
});
