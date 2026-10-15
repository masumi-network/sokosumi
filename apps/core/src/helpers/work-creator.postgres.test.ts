import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Prisma } from "@sokosumi/database";
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

const migrationSql = readFileSync(
  new URL(
    "../../../../packages/database/prisma/migrations/20261015095500_record_work_creator_and_requester/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const BOT = "01960001-0001-7001-8001-000000000001";
const TURN = "01960001-0001-7001-8001-000000000002";

/**
 * The tables as they stood before the migration, cut down to the columns and
 * constraints it touches.
 */
const BEFORE_MIGRATION = `
CREATE TABLE "user" (id text PRIMARY KEY);
CREATE TABLE coworker (id text PRIMARY KEY);
CREATE TABLE soko_bot (id uuid PRIMARY KEY);
CREATE TABLE soko_bot_turn (id uuid PRIMARY KEY, "sokoBotId" uuid NOT NULL);
CREATE TABLE soko_bot_delegation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "turnId" uuid NOT NULL,
  "jobId" text
);
CREATE TABLE task (
  id text PRIMARY KEY,
  "ownerId" text NOT NULL,
  "creatorUserId" text,
  "creatorCoworkerId" text,
  "creatorSokoBotId" uuid
);
CREATE TABLE task_schedule (
  id uuid PRIMARY KEY,
  "ownerId" text NOT NULL,
  "creatorUserId" text,
  "creatorCoworkerId" text,
  "creatorSokoBotId" uuid
);
CREATE TABLE "Job" (id text PRIMARY KEY, "ownerId" text NOT NULL);
ALTER TABLE task ADD CONSTRAINT "task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"(id) ON DELETE CASCADE;
ALTER TABLE task ADD CONSTRAINT "task_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"(id) ON DELETE RESTRICT;
ALTER TABLE task ADD CONSTRAINT task_creator_exactly_one_check CHECK (
  (("creatorUserId" IS NOT NULL)::int + ("creatorCoworkerId" IS NOT NULL)::int + ("creatorSokoBotId" IS NOT NULL)::int) = 1
);
ALTER TABLE task_schedule ADD CONSTRAINT "task_schedule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"(id) ON DELETE CASCADE;
ALTER TABLE task_schedule ADD CONSTRAINT "task_schedule_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "user"(id) ON DELETE RESTRICT;
ALTER TABLE task_schedule ADD CONSTRAINT task_schedule_creator_exactly_one_check CHECK (
  (("creatorUserId" IS NOT NULL)::int + ("creatorCoworkerId" IS NOT NULL)::int + ("creatorSokoBotId" IS NOT NULL)::int) = 1
);
ALTER TABLE "Job" ADD CONSTRAINT "Job_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"(id) ON DELETE CASCADE;
`;

const SCHEDULE_PERSON = "01960001-0001-7001-8001-0000000000a1";
const SCHEDULE_COWORKER = "01960001-0001-7001-8001-0000000000a2";
const SCHEDULE_BOT = "01960001-0001-7001-8001-0000000000a3";

const FIXTURE = `
INSERT INTO "user" VALUES ('ada'), ('bob');
INSERT INTO coworker VALUES ('cow');
INSERT INTO soko_bot VALUES ('${BOT}');
INSERT INTO soko_bot_turn VALUES ('${TURN}', '${BOT}');
INSERT INTO task (id, "ownerId", "creatorUserId", "creatorCoworkerId", "creatorSokoBotId") VALUES
  ('task-person', 'ada', 'ada', NULL, NULL),
  ('task-coworker', 'ada', NULL, 'cow', NULL),
  ('task-bot', 'bob', NULL, NULL, '${BOT}');
INSERT INTO task_schedule (id, "ownerId", "creatorUserId", "creatorCoworkerId", "creatorSokoBotId") VALUES
  ('${SCHEDULE_PERSON}', 'ada', 'ada', NULL, NULL),
  ('${SCHEDULE_COWORKER}', 'ada', NULL, 'cow', NULL),
  ('${SCHEDULE_BOT}', 'bob', NULL, NULL, '${BOT}');
INSERT INTO "Job" VALUES ('job-person', 'ada'), ('job-bot', 'bob');
INSERT INTO soko_bot_delegation ("turnId", "jobId") VALUES ('${TURN}', 'job-bot'), ('${TURN}', NULL);
`;

interface WorkRow {
  id: string;
  ownerId: string;
  creatorUserId: string | null;
  creatorCoworkerId: string | null;
  creatorSokoBotId: string | null;
  requestedByUserId: string | null;
}

async function withMigratedSchema(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db.$transaction(
    async (tx) => {
      const schema = `work_creator_test_${randomUUID().replaceAll("-", "")}`;
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe(BEFORE_MIGRATION);
      await tx.$executeRawUnsafe(FIXTURE);
      await tx.$executeRawUnsafe(migrationSql);
      await run(tx);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    },
    { timeout: 20000 },
  );
}

function rows(tx: Prisma.TransactionClient, table: string) {
  return tx.$queryRawUnsafe<WorkRow[]>(
    `SELECT id::text AS id, "ownerId", "creatorUserId", "creatorCoworkerId",
            "creatorSokoBotId"::text AS "creatorSokoBotId", "requestedByUserId"
     FROM ${table} ORDER BY id`,
  );
}

async function expectRefused(
  tx: Prisma.TransactionClient,
  statement: string,
  constraint: string,
) {
  await tx.$executeRawUnsafe("SAVEPOINT refused");
  await expect(tx.$executeRawUnsafe(statement)).rejects.toThrow(constraint);
  await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT refused");
}

// Opt-in real Postgres proof of the migration that records who made and who
// asked for work. It runs on stub tables in a throwaway schema.
describe.skipIf(!enabled)("work Creator and Requester migration", () => {
  it("backfills the Requester and Job Creator and leaves every Owner as it was", async () => {
    await withMigratedSchema(async (tx) => {
      expect(await rows(tx, "task")).toEqual([
        {
          id: "task-bot",
          ownerId: "bob",
          creatorUserId: null,
          creatorCoworkerId: null,
          creatorSokoBotId: BOT,
          requestedByUserId: "bob",
        },
        {
          id: "task-coworker",
          ownerId: "ada",
          creatorUserId: null,
          creatorCoworkerId: "cow",
          creatorSokoBotId: null,
          requestedByUserId: "ada",
        },
        {
          id: "task-person",
          ownerId: "ada",
          creatorUserId: "ada",
          creatorCoworkerId: null,
          creatorSokoBotId: null,
          requestedByUserId: null,
        },
      ]);
      expect(
        (await rows(tx, "task_schedule")).map((row) => [
          row.id,
          row.ownerId,
          row.requestedByUserId,
        ]),
      ).toEqual([
        [SCHEDULE_PERSON, "ada", null],
        [SCHEDULE_COWORKER, "ada", "ada"],
        [SCHEDULE_BOT, "bob", "bob"],
      ]);
      expect(await rows(tx, '"Job"')).toEqual([
        {
          id: "job-bot",
          ownerId: "bob",
          creatorUserId: null,
          creatorCoworkerId: null,
          creatorSokoBotId: BOT,
          requestedByUserId: "bob",
        },
        {
          id: "job-person",
          ownerId: "ada",
          creatorUserId: "ada",
          creatorCoworkerId: null,
          creatorSokoBotId: null,
          requestedByUserId: null,
        },
      ]);
    });
  });

  it("refuses a Requester beside a person Creator, and more than one Creator", async () => {
    await withMigratedSchema(async (tx) => {
      for (const [table, id, prefix] of [
        ["task", "'task-new'", "task"],
        ["task_schedule", "gen_random_uuid()", "task_schedule"],
        ['"Job"', "'job-new'", "Job"],
      ] as const) {
        await expectRefused(
          tx,
          `INSERT INTO ${table} (id, "ownerId", "creatorUserId", "requestedByUserId")
           VALUES (${id}, 'ada', 'ada', 'bob')`,
          `${prefix}_requester_not_person_creator_check`,
        );
        await expectRefused(
          tx,
          `INSERT INTO ${table} (id, "ownerId", "creatorUserId", "creatorCoworkerId")
           VALUES (${id}, 'ada', 'ada', 'cow')`,
          `${prefix}_creator_at_most_one_check`,
        );
      }
    });
  });

  it("empties a deleted person's Creator and Requester columns instead of failing", async () => {
    await withMigratedSchema(async (tx) => {
      await tx.$executeRawUnsafe(`
        INSERT INTO "user" VALUES ('cy');
        INSERT INTO task (id, "ownerId", "creatorUserId") VALUES ('made-by-cy', 'ada', 'cy');
        INSERT INTO task (id, "ownerId", "creatorCoworkerId", "requestedByUserId") VALUES ('asked-by-cy', 'ada', 'cow', 'cy');
        INSERT INTO task_schedule (id, "ownerId", "creatorUserId") VALUES (gen_random_uuid(), 'ada', 'cy');
        INSERT INTO "Job" (id, "ownerId", "creatorUserId") VALUES ('job-made-by-cy', 'ada', 'cy');
        INSERT INTO "Job" (id, "ownerId", "creatorSokoBotId", "requestedByUserId") VALUES ('job-asked-by-cy', 'ada', '${BOT}', 'cy');
      `);

      await tx.$executeRawUnsafe(`DELETE FROM "user" WHERE id = 'cy'`);

      const left = await tx.$queryRawUnsafe<{ refs: bigint }[]>(`
        SELECT count(*) AS refs FROM (
          SELECT "creatorUserId", "requestedByUserId" FROM task
          UNION ALL SELECT "creatorUserId", "requestedByUserId" FROM task_schedule
          UNION ALL SELECT "creatorUserId", "requestedByUserId" FROM "Job"
        ) refs WHERE 'cy' IN ("creatorUserId", "requestedByUserId")`);
      expect(left[0]?.refs).toBe(0n);
      const kept = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM task WHERE id IN ('made-by-cy', 'asked-by-cy')
         UNION ALL SELECT id FROM "Job" WHERE id IN ('job-made-by-cy', 'job-asked-by-cy')
         ORDER BY id`,
      );
      expect(kept.map((row) => row.id)).toEqual([
        "asked-by-cy",
        "job-asked-by-cy",
        "job-made-by-cy",
        "made-by-cy",
      ]);
    });
  });
});
