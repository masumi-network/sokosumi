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
    "../../../../packages/database/prisma/migrations/20261016100100_soko_bot_owner_scope_columns/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const OWNER = "owner-user";
const BOT = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000002";

// Opt-in real Postgres proof. Applies the migration to stub tables in a
// throwaway schema holding one bot and one integration from before it.
async function withMigratedStub(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        const schema = `owner_scope_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        await tx.$executeRawUnsafe(`CREATE TABLE "user" (id text PRIMARY KEY)`);
        await tx.$executeRawUnsafe(
          "CREATE TABLE project (id uuid PRIMARY KEY)",
        );
        await tx.$executeRawUnsafe(
          "CREATE TABLE chat_room (id uuid PRIMARY KEY)",
        );
        await tx.$executeRawUnsafe(
          `CREATE TABLE soko_bot (id uuid PRIMARY KEY, "userId" text NOT NULL)`,
        );
        await tx.$executeRawUnsafe(
          `CREATE TABLE soko_bot_integration (id uuid PRIMARY KEY, "sokoBotId" uuid NOT NULL)`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "user" VALUES ('${OWNER}'); INSERT INTO project VALUES ('${PROJECT}'); INSERT INTO soko_bot VALUES ('${BOT}', '${OWNER}'); INSERT INTO soko_bot_integration VALUES (gen_random_uuid(), '${BOT}')`,
        );
        await tx.$executeRawUnsafe(migrationSql);
        await run(tx);
        // Roll back so nothing outlives the test.
        throw new RollbackStub();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RollbackStub)) throw error;
    });
}

class RollbackStub extends Error {}

describe.skipIf(!enabled)(
  "Soko Bot owner scope migration against PostgreSQL",
  () => {
    it("records each existing bot's owner as its creator and as its integrations' connector", async () => {
      await withMigratedStub(async (tx) => {
        const [bot] = await tx.$queryRaw<{ createdByUserId: string | null }[]>`
        SELECT "createdByUserId" FROM soko_bot`;
        const [integration] = await tx.$queryRaw<
          { connectorUserId: string | null }[]
        >`SELECT "connectorUserId" FROM soko_bot_integration`;

        expect(bot?.createdByUserId).toBe(OWNER);
        expect(integration?.connectorUserId).toBe(OWNER);
      });
    });

    it("refuses a bot that is both personal and project scoped", async () => {
      await withMigratedStub(async (tx) => {
        await expect(
          tx.$executeRawUnsafe(
            `UPDATE soko_bot SET "projectId" = '${PROJECT}' WHERE id = '${BOT}'`,
          ),
        ).rejects.toThrow(/soko_bot_owner_scope_check/);
      });
    });
  },
);
