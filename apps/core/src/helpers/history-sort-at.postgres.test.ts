/**
 * Real-Postgres proof that the history feed's date survives a row touch.
 *
 *   RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://… \
 *     pnpm --filter core test src/helpers/history-sort-at.postgres.test.ts
 *
 * `history.sortAt` is both the feed's order key and the date every list built
 * on it renders — the Cmd+K palette included. It used to be written from the
 * source row's `updatedAt`, so the task tag classification backfill relabelled
 * a year of history as "today". These run against the migrated schema and the
 * live triggers, so a regression in the trigger body fails here rather than in
 * production. Every fixture is written inside a transaction that always rolls
 * back.
 */
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

afterAll(async () => {
  await db?.$disconnect();
});

const USER_ID = "hsort-user";
const WORKSPACE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const PROJECT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const VENDOR_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3";
const TASK_ID = "hsort-task";
const JOB_ID = "hsort-job";

/** Old enough that "yesterday" is unmistakably wrong. */
const TASK_CREATED_AT = "2026-02-11 09:30:00";
const JOB_CREATED_AT = "2026-03-04 14:15:00";

type Tx = Parameters<Parameters<NonNullable<typeof db>["$transaction"]>[0]>[0];

async function seed(tx: Tx): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
    VALUES (${USER_ID}, 'Sort User', 'hsort@example.test', true, NOW(), NOW())
  `;
  await tx.$executeRaw`
    INSERT INTO "workspace" ("id", "createdAt", "updatedAt", "userId", "organizationId")
    VALUES (${WORKSPACE_ID}::uuid, NOW(), NOW(), ${USER_ID}, NULL)
  `;
  await tx.$executeRaw`
    INSERT INTO "project" ("id", "createdAt", "updatedAt", "workspaceId", "name")
    VALUES (${PROJECT_ID}::uuid, NOW(), NOW(), ${WORKSPACE_ID}::uuid, 'Sort project')
  `;
  await tx.$executeRaw`
    INSERT INTO "AgentPricing" ("id", "createdAt", "updatedAt", "pricingType")
    VALUES ('hsort-pricing', NOW(), NOW(), 'FREE'::"PricingType")
  `;
  await tx.$executeRaw`
    INSERT INTO "Agent" (
      "id", "createdAt", "updatedAt", "blockchainIdentifier", "name", "apiBaseUrl",
      "lastUptimeCheck", "uptimeCount", "uptimeCheckCount", "pricingId", "isShown"
    )
    VALUES (
      'hsort-agent', NOW(), NOW(), 'hsort-agent-chain', 'Research Agent',
      'https://example.test/agent', NOW(), 1, 1, 'hsort-pricing', true
    )
  `;
  await tx.$executeRaw`
    INSERT INTO "vendor" ("id", "createdAt", "updatedAt", "name", "slug")
    VALUES (${VENDOR_ID}::uuid, NOW(), NOW(), 'Sort Vendor', 'hsort-vendor')
  `;

  // `createdAt` is written explicitly and `updatedAt` is NOW(), so a row that
  // took its feed date from `updatedAt` is obvious at a glance.
  await tx.$executeRaw`
    INSERT INTO "task" (
      "id", "createdAt", "updatedAt", "ownerId", "creatorUserId", "name",
      "description", "status", "workspaceId", "projectId"
    )
    VALUES (
      ${TASK_ID}, TIMESTAMP '2026-02-11 09:30:00', NOW(), ${USER_ID}, ${USER_ID},
      'Summarise the report', 'x', 'COMPLETED', ${WORKSPACE_ID}::uuid, ${PROJECT_ID}::uuid
    )
  `;
  // FREE, so `free_job_no_blockchain` keeps every blockchain column NULL and
  // the row needs no transaction. The feed date does not depend on either.
  await tx.$executeRaw`
    INSERT INTO "Job" (
      "id", "createdAt", "updatedAt", "ownerId", "agentId", "agentJobId",
      "jobType", "workspaceId", "projectId", "name"
    )
    VALUES (
      ${JOB_ID}, TIMESTAMP '2026-03-04 14:15:00', NOW(), ${USER_ID}, 'hsort-agent',
      'hsort-remote', 'FREE'::"JobType", ${WORKSPACE_ID}::uuid, ${PROJECT_ID}::uuid,
      'Research competitors'
    )
  `;
}

async function readSortAt(
  tx: Tx,
  kind: "TASK" | "JOB",
  entityId: string,
): Promise<string | undefined> {
  const rows = await tx.$queryRaw<Array<{ sortAt: Date }>>`
    SELECT "sortAt" FROM "history"
    WHERE "kind" = ${kind}::"HistoryKind" AND "entityId" = ${entityId}
  `;
  return rows[0]?.sortAt.toISOString();
}

/** Runs `body` against a seeded database and always rolls the fixtures back. */
async function withSeededHistory(
  body: (tx: Tx) => Promise<void>,
): Promise<void> {
  if (!db) throw new Error("Missing integration database");

  const rollback = new Error("Rollback history fixtures");
  try {
    await db.$transaction(
      async (tx) => {
        await seed(tx);
        await body(tx);
        throw rollback;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

describe.skipIf(!enabled)("history.sortAt against PostgreSQL", () => {
  it("dates a feed row from the entity's createdAt, not its updatedAt", async () => {
    await withSeededHistory(async (tx) => {
      expect(await readSortAt(tx, "TASK", TASK_ID)).toBe(
        new Date(`${TASK_CREATED_AT}Z`).toISOString(),
      );
      expect(await readSortAt(tx, "JOB", JOB_ID)).toBe(
        new Date(`${JOB_CREATED_AT}Z`).toISOString(),
      );
    });
  });

  it("does not move a feed row when only the entity's updatedAt is touched", async () => {
    await withSeededHistory(async (tx) => {
      const taskBefore = await readSortAt(tx, "TASK", TASK_ID);
      const jobBefore = await readSortAt(tx, "JOB", JOB_ID);

      // Exactly what the task tag classification backfill did to every
      // historical task, plus a bare row touch on the job.
      await tx.$executeRaw`
        UPDATE "task"
        SET "automaticTags" = ARRAY['research']::TEXT[],
            "tagClassificationState" = 'complete',
            "updatedAt" = NOW()
        WHERE "id" = ${TASK_ID}
      `;
      await tx.$executeRaw`UPDATE "Job" SET "updatedAt" = NOW() WHERE "id" = ${JOB_ID}`;

      expect(await readSortAt(tx, "TASK", TASK_ID)).toBe(taskBefore);
      expect(await readSortAt(tx, "JOB", JOB_ID)).toBe(jobBefore);
    });
  });

  it("keeps the feed date fixed when real activity re-syncs the row", async () => {
    await withSeededHistory(async (tx) => {
      const before = await readSortAt(tx, "TASK", TASK_ID);

      // `history_task_event_sync` re-runs `upsert_history_task`, so this is the
      // path that would reintroduce a moving date if the body regressed.
      await tx.$executeRaw`
        INSERT INTO "taskEvent" ("id", "createdAt", "updatedAt", "taskId", "comment")
        VALUES ('hsort-event', NOW(), NOW(), ${TASK_ID}, 'Agent run')
      `;

      expect(await readSortAt(tx, "TASK", TASK_ID)).toBe(before);
    });
  });
});
