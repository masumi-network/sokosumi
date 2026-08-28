import assert from "node:assert/strict";

import { afterAll, describe, it } from "vitest";

import { createPrismaClient } from "../../client.js";

const databaseUrl = process.env.DATABASE_URL;
const shouldRunDatabaseTests =
  Boolean(databaseUrl) && process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

const describeDatabase = shouldRunDatabaseTests ? describe : describe.skip;
const prisma = databaseUrl ? createPrismaClient(databaseUrl) : null;

function requirePrisma() {
  if (!prisma) {
    throw new Error("DATABASE_URL is required for database integration tests");
  }
  return prisma;
}

describeDatabase("Project Calendar history deletion guard", () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("blocks direct deletion for every retained Calendar record", async () => {
    const db = requirePrisma();

    const suffix = crypto.randomUUID();
    const userId = `calendar-guard-user-${suffix}`;
    const email = `calendar-guard-${suffix}@example.test`;
    const workspaceId = crypto.randomUUID();

    await db.$executeRaw`
      INSERT INTO "user" (
        "id",
        "name",
        "email",
        "emailVerified",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${userId},
        'Calendar Guard User',
        ${email},
        true,
        NOW(),
        NOW()
      )
    `;
    await db.workspace.create({
      data: { id: workspaceId, userId },
    });

    async function createProject(name: string) {
      return db.project.create({
        data: { workspaceId, name },
        select: { id: true },
      });
    }

    async function createTask(
      projectId: string,
      name: string,
      data: {
        metadata?: string;
        nextRunAt?: Date;
        status?: "DRAFT" | "QUEUED" | "READY";
      } = {},
    ) {
      return db.task.create({
        data: {
          ownerId: userId,
          creatorUserId: userId,
          workspaceId,
          projectId,
          name,
          ...data,
        },
        select: { id: true },
      });
    }

    async function deleteProject(projectId: string) {
      return db.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "project"
        WHERE id = ${projectId}::uuid
        RETURNING id
      `;
    }

    try {
      const ordinary = await createProject("Ordinary");
      assert.equal((await deleteProject(ordinary.id)).length, 1);

      const active = await createProject("Active schedule");
      await createTask(active.id, "Active series", {
        status: "QUEUED",
        metadata: JSON.stringify({
          version: 1,
          mode: "once",
          scheduledAt: "2026-08-26T09:00:00.000Z",
          runAt: "2099-08-26T09:00:00.000Z",
        }),
        nextRunAt: new Date("2099-08-26T09:00:00.000Z"),
      });
      assert.equal((await deleteProject(active.id)).length, 0);

      const malformed = await createProject("Malformed schedule");
      await createTask(malformed.id, "Malformed series", {
        metadata: "{broken",
      });
      assert.equal((await deleteProject(malformed.id)).length, 0);

      const quarantined = await createProject("Quarantined schedule");
      const quarantinedTask = await createTask(
        quarantined.id,
        "Quarantined series",
      );
      await db.taskScheduleQuarantine.create({
        data: {
          taskId: quarantinedTask.id,
          reason: "INVALID_METADATA",
          details: "metadata failed validation",
          capturedMetadata: null,
          capturedStatus: "DRAFT",
        },
      });
      assert.equal((await deleteProject(quarantined.id)).length, 0);

      const linked = await createProject("Schedule link");
      const linkedSeries = await createTask(linked.id, "Linked series");
      const linkedRelease = await createTask(linked.id, "Linked release", {
        status: "READY",
      });
      await db.taskLink.create({
        data: {
          fromTaskId: linkedSeries.id,
          toTaskId: linkedRelease.id,
          type: "SCHEDULE",
        },
      });
      assert.equal((await deleteProject(linked.id)).length, 0);

      const historical = await createProject("Occurrence history");
      const historicalSeries = await createTask(
        historical.id,
        "Historical series",
      );
      const historicalRelease = await createTask(
        historical.id,
        "Historical release",
        { status: "READY" },
      );
      await db.taskScheduleOccurrence.create({
        data: {
          seriesTaskId: historicalSeries.id,
          releasedTaskId: historicalRelease.id,
          legacyLinkId: `legacy-${suffix}`,
          effectiveScheduledAt: new Date("2026-08-20T09:00:00.000Z"),
          state: "RELEASED",
          sourceWorkspaceId: workspaceId,
          sourceType: "PROJECT",
          sourceProjectId: historical.id,
          sourceAccuracy: "INFERRED",
          timeAccuracy: "APPROXIMATE",
        },
      });
      assert.equal((await deleteProject(historical.id)).length, 0);

      await db.task.deleteMany({ where: { workspaceId } });
      const erasedWorkspace = await db.$queryRaw<Array<{ id: string }>>`
        DELETE FROM "workspace"
        WHERE id = ${workspaceId}::uuid
        RETURNING id
      `;
      assert.equal(erasedWorkspace.length, 1);
    } finally {
      await db.task.deleteMany({ where: { workspaceId } });
      await db.$executeRaw`
        DELETE FROM "workspace"
        WHERE id = ${workspaceId}::uuid
      `;
      await db.$executeRaw`
        DELETE FROM "user"
        WHERE id = ${userId}
      `;
    }
  });
});
