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
    // Quotes first: deleting a quoted post fires a BEFORE DELETE trigger that
    // updates its quotes, and a quote deleted in that same statement fails it.
    await prisma.socialPost.deleteMany({
      where: { workspaceId: { in: ids }, quotedPostId: { not: null } },
    });
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
    // A scheduled quote: the cancel fails it with a reason.
    const queuedDraft = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "And the replay",
      quotedPostId: scheduled.id,
    });
    const queued = await scheduleSocialPost({
      ...scope,
      postId: queuedDraft.id,
      revision: queuedDraft.revision,
      scheduledAt: new Date(at.getTime() + 3_600_000),
      timezone: "UTC",
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
    const failed = await prisma.socialPost.findUniqueOrThrow({
      where: { id: queued.id },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.needsAttentionReason).not.toBeNull();

    const restored = await restoreCanceledSocialPost({
      ...scope,
      postId: canceled.id,
      revision: canceled.revision,
      status: "SCHEDULED",
      scheduledAt: at,
      timezone: "UTC",
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
    // The failed quote keeps its reason: never a FAILED row without one.
    const stillFailed = await prisma.socialPost.findUniqueOrThrow({
      where: { id: queued.id },
    });
    expect(stillFailed.status).toBe("FAILED");
    expect(stillFailed.needsAttentionReason).toBe(failed.needsAttentionReason);
    expect(stillFailed.lastError).toBe(failed.lastError);
  });

  it("leaves the post cancelled, retry intact, when its schedule is refused", async () => {
    const { scope, socialConnectionId } = await seed();
    const at = new Date(Date.now() + 3 * 86_400_000);
    const draft = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "Launch day",
    });
    const canceled = await cancelSocialPost({
      ...scope,
      postId: draft.id,
      revision: draft.revision,
    });
    const past = new Date(Date.now() - 86_400_000);
    await expect(
      restoreCanceledSocialPost({
        ...scope,
        postId: canceled.id,
        revision: canceled.revision,
        status: "SCHEDULED",
        scheduledAt: past,
        timezone: "UTC",
      }),
    ).rejects.toThrow();
    const row = await prisma.socialPost.findUniqueOrThrow({
      where: { id: canceled.id },
    });
    expect(row.status).toBe("CANCELED");
    expect(row.revision).toBe(canceled.revision);
    const retried = await restoreCanceledSocialPost({
      ...scope,
      postId: canceled.id,
      revision: canceled.revision,
      status: "SCHEDULED",
      scheduledAt: at,
      timezone: "UTC",
    });
    expect(retried.status).toBe("SCHEDULED");
  });

  it("brings a cancelled FAILED or MISSED post back with its diagnostics (Codex)", async () => {
    const { scope, socialConnectionId } = await seed();
    for (const status of ["FAILED", "MISSED"] as const) {
      const draft = await createSocialPost({
        ...scope,
        socialConnectionId,
        text: `A ${status} post`,
      });
      const diagnostics = {
        lastError: `${status}: the network refused the media`,
        needsAttentionReason: `${status}: check the account`,
      };
      await prisma.socialPost.update({
        where: { id: draft.id },
        data: { status, ...diagnostics },
      });
      const settled = await prisma.socialPost.findUniqueOrThrow({
        where: { id: draft.id },
      });
      const canceled = await cancelSocialPost({
        ...scope,
        postId: settled.id,
        revision: settled.revision,
      });
      const back = await restoreCanceledSocialPost({
        ...scope,
        postId: canceled.id,
        revision: canceled.revision,
        status,
        scheduledAt: null,
        diagnostics,
      });
      expect(back.status).toBe(status);
      const row = await prisma.socialPost.findUniqueOrThrow({
        where: { id: draft.id },
      });
      expect(row.lastError).toBe(diagnostics.lastError);
      expect(row.needsAttentionReason).toBe(diagnostics.needsAttentionReason);
      expect(row.canceledAt).toBeNull();
    }
  });

  it("restores a quote whose quoted post stays cancelled with its warning (Codex)", async () => {
    const { scope, socialConnectionId } = await seed();
    const target = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "The launch",
    });
    const quoteDraft = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "About the launch",
      quotedPostId: target.id,
    });
    await prisma.socialPost.update({
      where: { id: quoteDraft.id },
      data: { status: "NEEDS_APPROVAL" },
    });
    const quote = await prisma.socialPost.findUniqueOrThrow({
      where: { id: quoteDraft.id },
    });
    const canceledQuote = await cancelSocialPost({
      ...scope,
      postId: quote.id,
      revision: quote.revision,
    });
    await cancelSocialPost({
      ...scope,
      postId: target.id,
      revision: target.revision,
    });
    await expect(
      restoreCanceledSocialPost({
        ...scope,
        postId: canceledQuote.id,
        revision: canceledQuote.revision,
        status: "SCHEDULED",
        scheduledAt: new Date(Date.now() + 3 * 86_400_000),
        timezone: "UTC",
      }),
    ).rejects.toThrow("restore that post first");
    const back = await restoreCanceledSocialPost({
      ...scope,
      postId: canceledQuote.id,
      revision: canceledQuote.revision,
      status: "NEEDS_APPROVAL",
      scheduledAt: null,
    });
    expect(back.status).toBe("NEEDS_APPROVAL");
    const row = await prisma.socialPost.findUniqueOrThrow({
      where: { id: quote.id },
    });
    expect(row.needsAttentionReason).not.toBeNull();
  });

  it("brings back the status it had and refuses a schedule without a time", async () => {
    const { scope, socialConnectionId } = await seed();
    const draft = await createSocialPost({
      ...scope,
      socialConnectionId,
      text: "Waiting for approval",
    });
    await prisma.socialPost.update({
      where: { id: draft.id },
      data: { status: "NEEDS_APPROVAL" },
    });
    const pending = await prisma.socialPost.findUniqueOrThrow({
      where: { id: draft.id },
    });
    const canceled = await cancelSocialPost({
      ...scope,
      postId: pending.id,
      revision: pending.revision,
    });
    await expect(
      restoreCanceledSocialPost({
        ...scope,
        postId: canceled.id,
        revision: canceled.revision,
        status: "SCHEDULED",
        scheduledAt: null,
      }),
    ).rejects.toThrow("A scheduled post is restored at its time");
    const back = await restoreCanceledSocialPost({
      ...scope,
      postId: canceled.id,
      revision: canceled.revision,
      status: "NEEDS_APPROVAL",
      scheduledAt: null,
    });
    expect(back.status).toBe("NEEDS_APPROVAL");
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
        status: "DRAFT",
        scheduledAt: null,
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
        status: "DRAFT",
        scheduledAt: null,
      }),
    ).rejects.toThrow();
    const back = await restoreCanceledSocialPost({
      ...scope,
      postId: canceled.id,
      revision: canceled.revision,
      status: "DRAFT",
      scheduledAt: null,
    });
    expect(back.status).toBe("DRAFT");
  });
});
