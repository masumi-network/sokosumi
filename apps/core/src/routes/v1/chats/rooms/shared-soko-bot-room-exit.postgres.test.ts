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
    "../../../../../../../packages/database/prisma/migrations/20261019085600_shared_soko_bot_room_survives_exit/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const ORG = `org-${randomUUID()}`;
const WS = randomUUID();
const BOT_ROOM = randomUUID();
const PLAIN_ROOM = randomUUID();
const ANA = `ana-${randomUUID()}`;
const BEN = `ben-${randomUUID()}`;
const CY = `cy-${randomUUID()}`;

class RollbackFixture extends Error {}

// The real schema with every trigger, re-applying this migration's function in
// the transaction so the test reads the file. `userId` is NOT NULL until the
// schema flip, so the transaction drops it to hold a shared bot, then rolls
// back.
async function withSharedRoom(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(migrationSql);
        await tx.$executeRawUnsafe(
          `ALTER TABLE soko_bot ALTER COLUMN "userId" DROP NOT NULL`,
        );
        for (const id of [ANA, BEN, CY]) {
          await tx.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
        }
        await tx.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Org', ${ORG})`;
        await tx.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${WS}::uuid, ${ORG}, now())`;
        for (const [id, slug] of [
          [BOT_ROOM, "team-bot"],
          [PLAIN_ROOM, "general"],
        ] as const) {
          await tx.$executeRaw`INSERT INTO chat_room (id, "organizationId", name, slug, kind, discoverability, "createdByUserId", "updatedAt") VALUES (${id}::uuid, ${ORG}, ${slug}, ${slug}, 'channel', 'public', ${ANA}, now())`;
        }
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "sharedRoomId", "updatedAt") VALUES (${randomUUID()}::uuid, NULL, ${WS}::uuid, ${BOT_ROOM}::uuid, now())`;
        // The join trigger puts both into the bot's room; the plain channel
        // gets them by hand.
        for (const userId of [ANA, BEN]) {
          await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${userId}, ${ORG}, 'member', now())`;
          await tx.$executeRaw`INSERT INTO chat_room_user_member (id, "roomId", "userId", access, "createdAt") VALUES (${randomUUID()}::uuid, ${PLAIN_ROOM}::uuid, ${userId}, 'member', now())`;
        }
        await run(tx);
        throw new RollbackFixture();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RollbackFixture)) throw error;
    });
}

async function archivedAt(tx: Prisma.TransactionClient, roomId: string) {
  const [row] = await tx.$queryRaw<{ archivedAt: Date | null }[]>`
    SELECT "archivedAt" FROM chat_room WHERE id = ${roomId}::uuid`;
  return row?.archivedAt;
}

async function humansIn(tx: Prisma.TransactionClient, roomId: string) {
  const [row] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM chat_room_user_member
    WHERE "roomId" = ${roomId}::uuid`;
  return row?.n;
}

describe.skipIf(!enabled)(
  "shared Soko Bot room on organization exit against PostgreSQL",
  () => {
    it("keeps the bot's room open after its last human leaves, and lets the next member in", async () => {
      await withSharedRoom(async (tx) => {
        expect(await humansIn(tx, BOT_ROOM)).toBe(2);

        await tx.$executeRaw`DELETE FROM member WHERE "organizationId" = ${ORG}`;

        expect(await humansIn(tx, BOT_ROOM)).toBe(0);
        expect(await archivedAt(tx, BOT_ROOM)).toBeNull();
        // A plain channel left empty still archives, as before.
        expect(await archivedAt(tx, PLAIN_ROOM)).toBeInstanceOf(Date);

        await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${CY}, ${ORG}, 'member', now())`;
        expect(await humansIn(tx, BOT_ROOM)).toBe(1);
      });
    });
  },
);
