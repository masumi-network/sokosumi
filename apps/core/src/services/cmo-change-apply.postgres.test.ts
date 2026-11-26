/**
 * Real-Postgres proof of the apply log under an owner's change to the
 * running month (cmo-v25, design v5): it opens only on the approved base it
 * was written on, records each op durably, and commits by clearing the
 * base's approval before setting the candidate's, under the real
 * one-approved index, with the base's unpublished posts following.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/services/cmo-change-apply.postgres.test.ts
 */
import { randomUUID } from "node:crypto";
import { marketingStrategyPlanSchema } from "@sokosumi/soko-bot";
import { afterEach, describe, expect, it } from "vitest";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import {
  beginCmoChangeApply,
  CMO_APPLY_STALE_MS,
  cmoApplyLogOf,
  commitCmoChangeApply,
  recordCmoApplyOp,
  staleCmoApplies,
} from "@/services/cmo-change-apply.service";
import { withFixtureSchemas } from "@/test/split-layout";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const seeded: { userId: string; organizationId: string }[] = [];

function plan(summary: string) {
  return marketingStrategyPlanSchema.parse({
    month: "2026-12",
    summary,
    goals: ["More trials"],
    pillars: [{ name: "How it works", share: 100, why: "The product" }],
    mix: [{ approach: "educational", share: 100, why: "Teach" }],
    channels: [{ channel: "x", cadence: "1 a day" }],
    contentLanguage: "English",
    calendar: [
      {
        id: "e1",
        date: "2026-12-01",
        time: "09:00",
        channel: "x",
        format: "post",
        status: "idea",
        title: "First",
      },
    ],
  });
}

async function seed() {
  const suffix = randomUUID().slice(0, 8);
  const userId = `change-apply-user-${suffix}`;
  const organizationId = `change-apply-org-${suffix}`;
  await prisma.user.create({
    data: {
      id: userId,
      name: "Change Apply",
      email: `change-apply-${suffix}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  seeded.push({ userId, organizationId });
  // Organization and Project fire triggers that name tables without a
  // schema (ticket 19): their fixture runs under this run's schemas.
  const { workspace, project } = await withFixtureSchemas(async (tx) => {
    await tx.organization.create({
      data: {
        id: organizationId,
        name: "Change Apply Org",
        slug: organizationId,
        members: { create: { userId, role: "owner" } },
      },
    });
    const workspace = await tx.workspace.create({
      data: { organizationId },
      select: { id: true },
    });
    const project = await tx.project.create({
      data: { workspaceId: workspace.id, name: "Apply test" },
      select: { id: true },
    });
    return { workspace, project };
  });
  const base = await prisma.marketingStrategy.create({
    data: {
      projectId: project.id,
      plan: jsonInput(plan("Base")),
      approvedAt: new Date(),
      approvedByUserId: userId,
    },
  });
  const candidate = await prisma.marketingStrategy.create({
    data: { projectId: project.id, plan: jsonInput(plan("Changed")) },
  });
  const post = (status: "SCHEDULED" | "DRAFT" | "PUBLISHED", text: string) =>
    prisma.socialPost.create({
      data: {
        projectId: project.id,
        workspaceId: workspace.id,
        provider: "x",
        text,
        status,
        creatorUserId: userId,
        marketingStrategyId: base.id,
      },
      select: { id: true },
    });
  const scheduled = await post("SCHEDULED", "Scheduled post");
  const draft = await post("DRAFT", "Draft post");
  const published = await post("PUBLISHED", "Published post");
  return {
    userId,
    projectId: project.id,
    base,
    candidateId: candidate.id,
    posts: { scheduled, draft, published },
  };
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
    await prisma.marketingStrategy.deleteMany({
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

const op = (opId: string, state: "intent" | "done" = "intent") => ({
  opId,
  entryId: "e1",
  kind: "move" as const,
  postId: null,
  prior: null,
  state,
});

describe.runIf(enabled)(
  "an owner's change applied to the running month",
  () => {
    it("commits by clearing the base's approval first, and its posts follow", async () => {
      const world = await seed();
      expect(
        await beginCmoChangeApply({
          candidateId: world.candidateId,
          baseVersionId: world.base.id,
          baseUpdatedAt: world.base.updatedAt.toISOString(),
        }),
      ).toEqual({ started: true });
      await recordCmoApplyOp(world.candidateId, op("op-1"));
      await recordCmoApplyOp(world.candidateId, op("op-2"));
      await recordCmoApplyOp(world.candidateId, op("op-1", "done"));
      expect(
        await commitCmoChangeApply({
          candidateId: world.candidateId,
          approverUserId: world.userId,
        }),
      ).toBe("applied");
      const versions = await prisma.marketingStrategy.findMany({
        where: { projectId: world.projectId },
        select: { id: true, approvedAt: true, plan: true },
      });
      const approved = versions.filter((version) => version.approvedAt);
      expect(approved.map((version) => version.id)).toEqual([
        world.candidateId,
      ]);
      const log = cmoApplyLogOf(
        versions.find((version) => version.id === world.candidateId)?.plan,
      );
      expect(log?.state).toBe("applied");
      expect(log?.ops.map((item) => [item.opId, item.state])).toEqual([
        ["op-1", "done"],
        ["op-2", "intent"],
      ]);
      const posts = await prisma.socialPost.findMany({
        where: { projectId: world.projectId },
        select: { id: true, marketingStrategyId: true },
      });
      const owner = new Map(
        posts.map((post) => [post.id, post.marketingStrategyId]),
      );
      expect(owner.get(world.posts.scheduled.id)).toBe(world.candidateId);
      expect(owner.get(world.posts.draft.id)).toBe(world.candidateId);
      expect(owner.get(world.posts.published.id)).toBe(world.base.id);
    });

    it("leaves the change a proposal when the base changed since it was written", async () => {
      const world = await seed();
      expect(
        await beginCmoChangeApply({
          candidateId: world.candidateId,
          baseVersionId: world.base.id,
          baseUpdatedAt: new Date(0).toISOString(),
        }),
      ).toEqual({
        started: false,
        reason: "the month changed since the change was written",
      });
      const candidate = await prisma.marketingStrategy.findUniqueOrThrow({
        where: { id: world.candidateId },
      });
      expect(candidate.approvedAt).toBeNull();
      expect(cmoApplyLogOf(candidate.plan)?.state).toBe("left");
    });

    it("never applies the same change twice", async () => {
      const world = await seed();
      const input = {
        candidateId: world.candidateId,
        baseVersionId: world.base.id,
        baseUpdatedAt: world.base.updatedAt.toISOString(),
      };
      expect(await beginCmoChangeApply(input)).toEqual({ started: true });
      expect(await beginCmoChangeApply(input)).toEqual({
        started: false,
        reason: "this change was applied before",
      });
    });

    it("refuses to commit after another version was approved meanwhile", async () => {
      const world = await seed();
      await beginCmoChangeApply({
        candidateId: world.candidateId,
        baseVersionId: world.base.id,
        baseUpdatedAt: world.base.updatedAt.toISOString(),
      });
      const other = await prisma.marketingStrategy.create({
        data: { projectId: world.projectId, plan: jsonInput(plan("Other")) },
      });
      await prisma.$transaction([
        prisma.marketingStrategy.update({
          where: { id: world.base.id },
          data: { approvedAt: null },
        }),
        prisma.marketingStrategy.update({
          where: { id: other.id },
          data: { approvedAt: new Date() },
        }),
      ]);
      expect(
        await commitCmoChangeApply({
          candidateId: world.candidateId,
          approverUserId: world.userId,
        }),
      ).toBe("base_changed");
      const candidate = await prisma.marketingStrategy.findUniqueOrThrow({
        where: { id: world.candidateId },
      });
      expect(candidate.approvedAt).toBeNull();
      const scheduled = await prisma.socialPost.findUniqueOrThrow({
        where: { id: world.posts.scheduled.id },
      });
      expect(scheduled.marketingStrategyId).toBe(world.base.id);
    });

    it("finds an apply that crashed with its invocation", async () => {
      const world = await seed();
      const started = new Date(Date.now() - CMO_APPLY_STALE_MS - 60_000);
      await beginCmoChangeApply({
        candidateId: world.candidateId,
        baseVersionId: world.base.id,
        baseUpdatedAt: world.base.updatedAt.toISOString(),
        now: started,
      });
      expect(await staleCmoApplies()).toContain(world.candidateId);
      expect(await staleCmoApplies(started)).not.toContain(world.candidateId);
    });
  },
);
