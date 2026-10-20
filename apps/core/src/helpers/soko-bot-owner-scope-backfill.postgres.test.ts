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
    "../../../../packages/database/prisma/migrations/20261019090300_soko_bot_owner_scope_backfill_rerun/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const OWNER = `owner-${randomUUID()}`;
const OTHER = `other-${randomUUID()}`;
const ORG = `org-${randomUUID()}`;
const WS = randomUUID();
const PERSONAL_BOT = randomUUID();
const CREATED_BOT = randomUUID();
const SHARED_BOT = randomUUID();

class RollbackFixture extends Error {}

// Rows the previous release wrote after the column migration. `userId` is NOT
// NULL until the schema flip, so the transaction drops it to hold a shared
// bot, then rolls back.
async function withOldReleaseRows(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `ALTER TABLE soko_bot ALTER COLUMN "userId" DROP NOT NULL`,
        );
        for (const id of [OWNER, OTHER]) {
          await tx.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
        }
        await tx.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Org', ${ORG})`;
        await tx.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${WS}::uuid, ${ORG}, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "createdByUserId", "updatedAt") VALUES
          (${PERSONAL_BOT}::uuid, ${OWNER}, ${WS}::uuid, NULL, now()),
          (${CREATED_BOT}::uuid, ${OTHER}, ${WS}::uuid, ${OWNER}, now()),
          (${SHARED_BOT}::uuid, NULL, ${WS}::uuid, NULL, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot_integration (id, "updatedAt", "sokoBotId", provider, "composioAccountId", "connectorUserId") VALUES
          (${randomUUID()}::uuid, now(), ${PERSONAL_BOT}::uuid, 'gmail', 'acct-1', NULL),
          (${randomUUID()}::uuid, now(), ${CREATED_BOT}::uuid, 'gmail', 'acct-2', ${OWNER}),
          (${randomUUID()}::uuid, now(), ${SHARED_BOT}::uuid, 'gmail', 'acct-3', NULL)`;
        await tx.$executeRawUnsafe(migrationSql);
        await run(tx);
        throw new RollbackFixture();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RollbackFixture)) throw error;
    });
}

describe.skipIf(!enabled)(
  "Soko Bot owner scope backfill re-run against PostgreSQL",
  () => {
    it("fills creator and connector from the owner of personal bots only", async () => {
      await withOldReleaseRows(async (tx) => {
        const bots = await tx.$queryRaw<
          { id: string; createdByUserId: string | null }[]
        >`SELECT id::text AS id, "createdByUserId" FROM soko_bot
          WHERE id IN (${PERSONAL_BOT}::uuid, ${CREATED_BOT}::uuid, ${SHARED_BOT}::uuid)`;
        expect(
          Object.fromEntries(bots.map((bot) => [bot.id, bot.createdByUserId])),
        ).toEqual({
          [PERSONAL_BOT]: OWNER,
          [CREATED_BOT]: OWNER,
          [SHARED_BOT]: null,
        });

        const integrations = await tx.$queryRaw<
          { sokoBotId: string; connectorUserId: string | null }[]
        >`SELECT "sokoBotId"::text AS "sokoBotId", "connectorUserId" FROM soko_bot_integration
          WHERE "sokoBotId" IN (${PERSONAL_BOT}::uuid, ${CREATED_BOT}::uuid, ${SHARED_BOT}::uuid)`;
        expect(
          Object.fromEntries(
            integrations.map((row) => [row.sokoBotId, row.connectorUserId]),
          ),
        ).toEqual({
          [PERSONAL_BOT]: OWNER,
          [CREATED_BOT]: OWNER,
          [SHARED_BOT]: null,
        });
      });
    });
  },
);
