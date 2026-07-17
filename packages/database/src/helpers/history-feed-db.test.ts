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
            "ownerId",
            "creatorUserId",
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

  it("recomputes job history status when jobInput is submitted", async () => {
    assert.ok(prisma);

    const suffix = crypto.randomUUID();
    const userId = `history-job-user-${suffix}`;
    const jobId = `history-job-${suffix}`;
    const eventId = `history-job-event-${suffix}`;
    const agentId = `history-agent-${suffix}`;
    const pricingId = `history-pricing-${suffix}`;
    const email = `history-job-${suffix}@example.test`;

    try {
      const beforeInputRows = await prisma.$queryRaw<Array<{ status: string }>>`
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
            'History Job Trigger User',
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
        created_pricing AS (
          INSERT INTO "AgentPricing" (
            "id",
            "createdAt",
            "updatedAt",
            "pricingType"
          )
          VALUES (
            ${pricingId},
            NOW(),
            NOW(),
            'FREE'::"PricingType"
          )
          RETURNING "id"
        ),
        created_agent AS (
          INSERT INTO "Agent" (
            "id",
            "createdAt",
            "updatedAt",
            "blockchainIdentifier",
            "name",
            "apiBaseUrl",
            "lastUptimeCheck",
            "uptimeCount",
            "uptimeCheckCount",
            "pricingId",
            "isShown"
          )
          SELECT
            ${agentId},
            NOW(),
            NOW(),
            ${`history-agent-${suffix}`},
            'History Trigger Agent',
            'https://example.test/agent',
            NOW(),
            1,
            1,
            "id",
            true
          FROM created_pricing
          RETURNING "id"
        ),
        created_job AS (
          INSERT INTO "Job" (
            "id",
            "createdAt",
            "updatedAt",
            "userId",
            "agentId",
            "agentJobId",
            "jobType",
            "workspaceId"
          )
          SELECT
            ${jobId},
            NOW(),
            NOW(),
            ${userId},
            "id",
            ${`remote-${suffix}`},
            'FREE'::"JobType",
            (SELECT "id" FROM created_workspace)
          FROM created_agent
          RETURNING "id"
        ),
        created_event AS (
          INSERT INTO "jobEvent" (
            "id",
            "createdAt",
            "updatedAt",
            "jobId",
            "status"
          )
          SELECT
            ${eventId},
            NOW(),
            NOW(),
            "id",
            'AWAITING_INPUT'::"AgentJobStatus"
          FROM created_job
          RETURNING "id", "jobId"
        )
        SELECT "status"
        FROM "history"
        WHERE "kind" = 'JOB'::"HistoryKind"
          AND "entityId" = (SELECT "jobId"::TEXT FROM created_event)
      `;

      assert.equal(beforeInputRows.length, 1);
      assert.equal(beforeInputRows[0]?.status, "input_required");

      const afterInputRows = await prisma.$queryRaw<Array<{ status: string }>>`
        WITH submitted_input AS (
          INSERT INTO "jobInput" (
            "id",
            "createdAt",
            "updatedAt",
            "eventId",
            "input"
          )
          VALUES (
            ${`history-job-input-${suffix}`},
            NOW(),
            NOW(),
            ${eventId},
            '{"answer":"yes"}'
          )
          RETURNING "eventId"
        )
        SELECT "status"
        FROM "history"
        WHERE "kind" = 'JOB'::"HistoryKind"
          AND "entityId" = (
            SELECT e."jobId"
            FROM "jobEvent" AS e
            WHERE e."id" = (SELECT "eventId" FROM submitted_input)
          )
      `;

      assert.equal(afterInputRows.length, 1);
      assert.equal(afterInputRows[0]?.status, "processing");
    } finally {
      await prisma.$executeRaw`
        DELETE FROM "history"
        WHERE "entityId" = ${jobId}
      `;
      await prisma.$executeRaw`
        DELETE FROM "user"
        WHERE "id" = ${userId}
      `;
    }
  });
});
