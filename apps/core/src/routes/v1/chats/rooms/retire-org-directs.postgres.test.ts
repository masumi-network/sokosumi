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
    "../../../../../../../packages/database/prisma/migrations/20261028142317_retire_org_directs/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const ORG1 = `org-${randomUUID()}`;
const ORG2 = `org-${randomUUID()}`;
const WS1 = randomUUID();
const ANA = `ana-${randomUUID()}`;
const BEN = `ben-${randomUUID()}`;
const CY = `cy-${randomUUID()}`;
const BOT = randomUUID();
const VENDOR = randomUUID();
const COWORKER = `coworker-${randomUUID()}`;
const PAIR_KEY = [ANA, BEN].sort().join(":");
const GROUP_KEY = `direct:v2:${[ANA, BEN, CY]
  .map((id) => `user:${id}`)
  .sort()
  .join(":")}`;
const BOT_KEY = `sokoBot:${ANA}:${BOT}`;
const FORMER_KEY = [ANA, CY].sort().join(":");
const COWORKER_KEY = `coworker:${ANA}:${COWORKER}`;

// Oldest first: the Org1 Direct survives the Personal and Org2 copies.
const ORG1_PAIR = randomUUID();
const PERSONAL_PAIR = randomUUID();
const ORG2_PAIR = randomUUID();
const ORG1_GROUP = randomUUID();
const BOT_DIRECT = randomUUID();
const CHANNEL = randomUUID();
// Cy left the older Org1 copy; the Personal copy still has Cy.
const ORG1_FORMER_PAIR = randomUUID();
const PERSONAL_FORMER_PAIR = randomUUID();
const ORG1_COWORKER = randomUUID();
const ORG2_COWORKER = randomUUID();

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute));

class RollbackFixture extends Error {}

// The real migrated schema with every trigger. Org Directs are written as they
// were before this migration, then the migration runs again in the
// transaction, and everything rolls back.
async function withDuplicateDirects(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        for (const id of [ANA, BEN, CY]) {
          await tx.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
        }
        for (const org of [ORG1, ORG2]) {
          await tx.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${org}, ${org}, ${org})`;
          for (const userId of [ANA, BEN]) {
            await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${userId}, ${org}, 'member', now())`;
          }
        }
        await tx.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${WS1}::uuid, ${ORG1}, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${ANA}, ${WS1}::uuid, now())`;
        await tx.$executeRaw`INSERT INTO vendor (id, name, slug, "updatedAt") VALUES (${VENDOR}::uuid, 'Vendor', ${`vendor-${VENDOR}`}, now())`;
        await tx.$executeRaw`INSERT INTO coworker (id, slug, name, "vendorId", "updatedAt") VALUES (${COWORKER}, ${COWORKER}, 'Coworker', ${VENDOR}::uuid, now())`;

        const rooms: [string, string | null, string, string, number][] = [
          [ORG1_PAIR, ORG1, "direct", PAIR_KEY, 0],
          [PERSONAL_PAIR, null, "direct", PAIR_KEY, 10],
          [ORG2_PAIR, ORG2, "direct", PAIR_KEY, 20],
          [ORG1_GROUP, ORG1, "direct", GROUP_KEY, 0],
          [BOT_DIRECT, ORG1, "direct", BOT_KEY, 0],
          [ORG1_FORMER_PAIR, ORG1, "direct", FORMER_KEY, 0],
          [PERSONAL_FORMER_PAIR, null, "direct", FORMER_KEY, 10],
          [ORG1_COWORKER, ORG1, "direct", COWORKER_KEY, 0],
          [ORG2_COWORKER, ORG2, "direct", COWORKER_KEY, 10],
        ];
        for (const [id, org, kind, key, minute] of rooms) {
          await tx.$executeRaw`INSERT INTO chat_room (id, "organizationId", name, kind, "directKey", "createdByUserId", "createdAt", "updatedAt") VALUES (${id}::uuid, ${org}, 'Direct', ${kind}, ${key}, ${ANA}, ${at(minute)}, ${at(minute)})`;
        }
        await tx.$executeRaw`INSERT INTO chat_room (id, "organizationId", name, slug, kind, discoverability, "createdByUserId", "updatedAt") VALUES (${CHANNEL}::uuid, ${ORG1}, 'general', ${`general-${CHANNEL}`}, 'channel', 'public', ${ANA}, now())`;
        await tx.$executeRaw`INSERT INTO chat_room_soko_bot_member (id, "roomId", "sokoBotId") VALUES (${randomUUID()}::uuid, ${BOT_DIRECT}::uuid, ${BOT}::uuid)`;
        for (const roomId of [ORG1_COWORKER, ORG2_COWORKER]) {
          await tx.$executeRaw`INSERT INTO chat_room_coworker_member (id, "roomId", "coworkerId") VALUES (${randomUUID()}::uuid, ${roomId}::uuid, ${COWORKER})`;
        }

        // An earlier exit already took Cy out of the group.
        const memberships: [string, string][] = [
          [ORG1_PAIR, ANA],
          [ORG1_PAIR, BEN],
          [PERSONAL_PAIR, ANA],
          [PERSONAL_PAIR, BEN],
          [ORG2_PAIR, ANA],
          [ORG2_PAIR, BEN],
          [ORG1_GROUP, ANA],
          [ORG1_GROUP, BEN],
          [BOT_DIRECT, ANA],
          [CHANNEL, ANA],
          [ORG1_FORMER_PAIR, ANA],
          [PERSONAL_FORMER_PAIR, ANA],
          [PERSONAL_FORMER_PAIR, CY],
          [ORG1_COWORKER, ANA],
          [ORG2_COWORKER, ANA],
        ];
        for (const [roomId, userId] of memberships) {
          await tx.$executeRaw`INSERT INTO chat_room_user_member (id, "roomId", "userId", access, "createdAt") VALUES (${randomUUID()}::uuid, ${roomId}::uuid, ${userId}, 'member', now())`;
        }

        // Ana read the Org2 copy last, Ben the Personal copy.
        const reads: [string, string, number][] = [
          [ORG1_PAIR, ANA, 1],
          [PERSONAL_PAIR, ANA, 11],
          [ORG2_PAIR, ANA, 25],
          [ORG1_PAIR, BEN, 2],
          [PERSONAL_PAIR, BEN, 15],
        ];
        for (const [roomId, userId, minute] of reads) {
          await tx.$executeRaw`INSERT INTO chat_room_read_state (id, "roomId", "userId", "lastReadAt", "updatedAt") VALUES (${randomUUID()}::uuid, ${roomId}::uuid, ${userId}, ${at(minute)}, now())`;
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

async function sendMessage(
  tx: Prisma.TransactionClient,
  roomId: string,
  content: string,
  minute: number,
  parentMessageId: string | null = null,
) {
  const id = randomUUID();
  await tx.$executeRaw`INSERT INTO chat_room_message (id, "roomId", "parentMessageId", content, "senderUserId", "createdAt") VALUES (${id}::uuid, ${roomId}::uuid, ${parentMessageId}::uuid, ${content}, ${ANA}, ${at(minute)})`;
  return id;
}

async function roomsWithKey(tx: Prisma.TransactionClient, directKey: string) {
  return tx.$queryRaw<{ id: string; organizationId: string | null }[]>`
    SELECT id::text, "organizationId" FROM chat_room WHERE "directKey" = ${directKey}`;
}

async function memberIds(tx: Prisma.TransactionClient, roomId: string) {
  const rows = await tx.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM chat_room_user_member WHERE "roomId" = ${roomId}::uuid ORDER BY "userId"`;
  return rows.map((row) => row.userId);
}

async function roomIdsOf(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ roomId: string }[]>`
    SELECT "roomId"::text FROM chat_room_user_member WHERE "userId" = ${userId} ORDER BY "roomId"`;
  return rows.map((row) => row.roomId).sort();
}

describe.skipIf(!enabled)("retiring Org Directs against PostgreSQL", () => {
  it("merges every human Direct of the same people into the oldest, with no Organization", async () => {
    await withDuplicateDirects(async (tx) => {
      const first = await sendMessage(tx, ORG1_PAIR, "org1 hello", 1);
      await sendMessage(tx, ORG1_PAIR, "org1 reply", 30, first);
      await tx.$executeRaw`INSERT INTO chat_room_reaction (id, "messageId", "userId", emoji) VALUES (${randomUUID()}::uuid, ${first}::uuid, ${BEN}, '👍')`;
      await sendMessage(tx, PERSONAL_PAIR, "personal hello", 12);
      await sendMessage(tx, ORG2_PAIR, "org2 hello", 21);

      await tx.$executeRawUnsafe(migrationSql);

      expect(await roomsWithKey(tx, PAIR_KEY)).toEqual([
        { id: ORG1_PAIR, organizationId: null },
      ]);
      const messages = await tx.$queryRaw<
        { content: string; parent: string | null }[]
      >`SELECT content, "parentMessageId"::text AS parent FROM chat_room_message WHERE "roomId" = ${ORG1_PAIR}::uuid ORDER BY "createdAt"`;
      expect(messages).toEqual([
        { content: "org1 hello", parent: null },
        { content: "personal hello", parent: null },
        { content: "org2 hello", parent: null },
        { content: "org1 reply", parent: first },
      ]);
      const [reaction] = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM chat_room_reaction WHERE "messageId" = ${first}::uuid`;
      expect(reaction?.n).toBe(1);
      expect(await memberIds(tx, ORG1_PAIR)).toEqual([ANA, BEN].sort());

      const reads = await tx.$queryRaw<{ userId: string; lastReadAt: Date }[]>`
        SELECT "userId", "lastReadAt" FROM chat_room_read_state WHERE "roomId" = ${ORG1_PAIR}::uuid ORDER BY "userId"`;
      expect(
        Object.fromEntries(reads.map((r) => [r.userId, r.lastReadAt])),
      ).toEqual({ [ANA]: at(25), [BEN]: at(15) });
    });
  });

  it("clears the Organization of a lone Org Direct without putting back a former member", async () => {
    await withDuplicateDirects(async (tx) => {
      await tx.$executeRawUnsafe(migrationSql);

      expect(await roomsWithKey(tx, GROUP_KEY)).toEqual([
        { id: ORG1_GROUP, organizationId: null },
      ]);
      expect(await memberIds(tx, ORG1_GROUP)).toEqual([ANA, BEN].sort());
    });
  });

  it("leaves a Soko Bot Direct in its Organization", async () => {
    await withDuplicateDirects(async (tx) => {
      await tx.$executeRawUnsafe(migrationSql);

      expect(await roomsWithKey(tx, BOT_KEY)).toEqual([
        { id: BOT_DIRECT, organizationId: ORG1 },
      ]);
    });
  });

  it("keeps a member of any copy in the merged Direct, even one who left the older Org Direct", async () => {
    await withDuplicateDirects(async (tx) => {
      await tx.$executeRawUnsafe(migrationSql);

      expect(await roomsWithKey(tx, FORMER_KEY)).toEqual([
        { id: ORG1_FORMER_PAIR, organizationId: null },
      ]);
      expect(await memberIds(tx, ORG1_FORMER_PAIR)).toEqual([ANA, CY].sort());
    });
  });

  it("leaves Coworker 1:1s in their Organizations, unmerged", async () => {
    await withDuplicateDirects(async (tx) => {
      await tx.$executeRawUnsafe(migrationSql);

      const rooms = await roomsWithKey(tx, COWORKER_KEY);
      expect(rooms).toHaveLength(2);
      expect(rooms).toEqual(
        expect.arrayContaining([
          { id: ORG1_COWORKER, organizationId: ORG1 },
          { id: ORG2_COWORKER, organizationId: ORG2 },
        ]),
      );
    });
  });

  it("keeps Personal Directs on Organization exit, drops its Channels and AI Directs, and restores nothing on rejoin", async () => {
    await withDuplicateDirects(async (tx) => {
      await tx.$executeRawUnsafe(migrationSql);

      await tx.$executeRaw`DELETE FROM member WHERE "userId" = ${ANA} AND "organizationId" = ${ORG1}`;

      // Org1's Coworker 1:1 goes with the Channel; Org2's stays.
      const anaAfterExit = [
        ORG1_PAIR,
        ORG1_GROUP,
        ORG1_FORMER_PAIR,
        ORG2_COWORKER,
      ].sort();
      expect(await roomIdsOf(tx, ANA)).toEqual(anaAfterExit);
      expect(await roomsWithKey(tx, BOT_KEY)).toEqual([]);

      await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${ANA}, ${ORG1}, 'member', now())`;

      expect(await roomIdsOf(tx, ANA)).toEqual(anaAfterExit);
    });
  });
});
