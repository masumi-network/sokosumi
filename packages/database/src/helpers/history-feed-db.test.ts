import assert from "node:assert/strict";

import { afterAll, describe, it } from "vitest";

import { createPrismaClient } from "../client.js";

const databaseUrl = process.env.DATABASE_URL;
const shouldRunDatabaseTests =
  Boolean(databaseUrl) && process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

const describeDatabase = shouldRunDatabaseTests ? describe : describe.skip;
const prisma = databaseUrl ? createPrismaClient(databaseUrl) : null;

describeDatabase("history feed database triggers", () => {
  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("creates and archives task history rows from database triggers", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const userId = `history-user-${suffix}`;
    const taskId = `history-task-${suffix}`;
    const email = `history-${suffix}@example.test`;

    try {
      const rows = await prisma.$queryRaw<
        Array<{
          archivedAt: Date | null;
          entityId: string;
          kind: string;
          status: string;
          title: string;
        }>
      >`
        WITH created_user AS (
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
            'History Trigger User',
            ${email},
            true,
            NOW(),
            NOW()
          )
          RETURNING "id"
        ),
        created_workspace AS (
          INSERT INTO "workspace" (
            "id",
            "createdAt",
            "updatedAt",
            "userId"
          )
          SELECT gen_random_uuid(), NOW(), NOW(), "id"
          FROM created_user
          RETURNING "id"
        ),
        created_task AS (
          INSERT INTO "task" (
            "id",
            "createdAt",
            "updatedAt",
            "userId",
            "name",
            "description",
            "status",
            "workspaceId"
          )
          SELECT
            ${taskId},
            NOW(),
            NOW(),
            ${userId},
            'History trigger task',
            'Created by trigger test',
            'READY',
            "id"
          FROM created_workspace
          RETURNING "id"
        )
        SELECT
          "kind"::TEXT AS "kind",
          "entityId",
          "title",
          "status",
          "archivedAt"
        FROM "history"
        WHERE "kind" = 'TASK'::"HistoryKind"
          AND "entityId" = (SELECT "id" FROM created_task)
      `;

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.kind, "TASK");
      assert.equal(rows[0]?.entityId, taskId);
      assert.equal(rows[0]?.title, "History trigger task");
      assert.equal(rows[0]?.status, "READY");
      assert.equal(rows[0]?.archivedAt, null);

      const archivedRows = await prisma.$queryRaw<
        Array<{ archivedAt: Date | null }>
      >`
        WITH archived_task AS (
          UPDATE "task"
          SET "archivedAt" = NOW()
          WHERE "id" = ${taskId}
          RETURNING "id"
        )
        SELECT "archivedAt"
        FROM "history"
        WHERE "kind" = 'TASK'::"HistoryKind"
          AND "entityId" = (SELECT "id" FROM archived_task)
      `;

      assert.equal(archivedRows.length, 1);
      assert.ok(archivedRows[0]?.archivedAt instanceof Date);
    } finally {
      await prisma.$executeRaw`
        DELETE FROM "history"
        WHERE "entityId" = ${taskId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "user"
        WHERE "id" = ${userId}
      `;
    }
  });
});
