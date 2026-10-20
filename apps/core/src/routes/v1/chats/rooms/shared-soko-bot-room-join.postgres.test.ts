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
    "../../../../../../../packages/database/prisma/migrations/20261016100200_shared_soko_bot_room_member_join/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const WS_ORG1 = "00000000-0000-4000-8000-0000000000a1";
const WS_ORG2 = "00000000-0000-4000-8000-0000000000a2";
const SHARED_ROOM = "00000000-0000-4000-8000-000000000001";
const ARCHIVED_ROOM = "00000000-0000-4000-8000-000000000002";
const OTHER_ORG_ROOM = "00000000-0000-4000-8000-000000000003";
const PLAIN_CHANNEL = "00000000-0000-4000-8000-000000000004";
const FOREIGN_ROOM = "00000000-0000-4000-8000-000000000005";
const CROSS_BOT_ROOM = "00000000-0000-4000-8000-000000000006";
const DELETED_BOT_ROOM = "00000000-0000-4000-8000-000000000007";
const PERSONAL_BOT_ROOM = "00000000-0000-4000-8000-000000000008";

class RollbackStub extends Error {}

// Opt-in real Postgres proof. Applies the migration to stub tables in a
// throwaway schema, then rolls everything back.
async function withMigratedStub(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        const schema = `shared_room_join_test_${randomUUID().replaceAll("-", "")}`;
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const sql of [
          `CREATE TABLE organization (id text PRIMARY KEY)`,
          `INSERT INTO organization VALUES ('org1'), ('org2'), ('org3')`,
          `CREATE TABLE member (id text PRIMARY KEY, "organizationId" text, "userId" text)`,
          `CREATE TABLE workspace (id uuid PRIMARY KEY, "organizationId" text)`,
          `CREATE TABLE chat_room (id uuid PRIMARY KEY, "organizationId" text, kind text, "archivedAt" timestamp)`,
          `CREATE TABLE soko_bot (id uuid PRIMARY KEY, "userId" text, "deletedAt" timestamp, "workspaceId" uuid, "sharedRoomId" uuid)`,
          `CREATE TABLE chat_room_user_member (id uuid PRIMARY KEY, "roomId" uuid, "userId" text, access text, "createdAt" timestamp)`,
          `CREATE UNIQUE INDEX ON chat_room_user_member ("roomId", "userId")`,
          `CREATE TABLE chat_room_read_state (id uuid PRIMARY KEY, "roomId" uuid, "userId" text, "lastReadAt" timestamp, "createdAt" timestamp, "updatedAt" timestamp)`,
          `CREATE UNIQUE INDEX ON chat_room_read_state ("roomId", "userId")`,
          `INSERT INTO workspace VALUES ('${WS_ORG1}', 'org1'), ('${WS_ORG2}', 'org2')`,
          `INSERT INTO chat_room VALUES
            ('${SHARED_ROOM}', 'org1', 'channel', NULL),
            ('${ARCHIVED_ROOM}', 'org1', 'channel', now()),
            ('${OTHER_ORG_ROOM}', 'org2', 'channel', NULL),
            ('${PLAIN_CHANNEL}', 'org1', 'channel', NULL),
            ('${FOREIGN_ROOM}', 'org2', 'channel', NULL),
            ('${CROSS_BOT_ROOM}', 'org1', 'channel', NULL),
            ('${DELETED_BOT_ROOM}', 'org1', 'channel', NULL),
            ('${PERSONAL_BOT_ROOM}', 'org1', 'channel', NULL)`,
          `INSERT INTO soko_bot VALUES
            (gen_random_uuid(), NULL, NULL, '${WS_ORG1}', '${SHARED_ROOM}'),
            (gen_random_uuid(), NULL, NULL, '${WS_ORG1}', '${ARCHIVED_ROOM}'),
            (gen_random_uuid(), NULL, NULL, '${WS_ORG2}', '${OTHER_ORG_ROOM}'),
            (gen_random_uuid(), 'owner', NULL, '${WS_ORG1}', NULL),
            (gen_random_uuid(), NULL, NULL, '${WS_ORG1}', '${FOREIGN_ROOM}'),
            (gen_random_uuid(), NULL, NULL, '${WS_ORG2}', '${CROSS_BOT_ROOM}'),
            (gen_random_uuid(), NULL, now(), '${WS_ORG1}', '${DELETED_BOT_ROOM}')`,
        ]) {
          await tx.$executeRawUnsafe(sql);
        }
        await tx.$executeRawUnsafe(migrationSql);
        await run(tx);
        throw new RollbackStub();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RollbackStub)) throw error;
    });
}

async function roomsOf(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRawUnsafe<{ roomId: string; access: string }[]>(
    `SELECT "roomId"::text AS "roomId", access FROM chat_room_user_member WHERE "userId" = $1 ORDER BY "roomId"`,
    userId,
  );
  return rows;
}

describe.skipIf(!enabled)(
  "shared Soko Bot room join trigger against PostgreSQL",
  () => {
    it("puts a new organization member into each live shared room of that organization only", async () => {
      await withMigratedStub(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO member VALUES ('m1', 'org1', 'ana')`,
        );

        expect(await roomsOf(tx, "ana")).toEqual([
          { roomId: SHARED_ROOM, access: "member" },
        ]);
        const [readState] = await tx.$queryRawUnsafe<
          { lastReadAt: Date | null }[]
        >(
          `SELECT "lastReadAt" FROM chat_room_read_state WHERE "userId" = 'ana' AND "roomId" = '${SHARED_ROOM}'`,
        );
        expect(readState?.lastReadAt).toBeInstanceOf(Date);
      });
    });

    it("refuses a shared room on a bot with an owner", async () => {
      await withMigratedStub(async (tx) => {
        await expect(
          tx.$executeRawUnsafe(
            `INSERT INTO soko_bot VALUES (gen_random_uuid(), 'owner', NULL, '${WS_ORG1}', '${PERSONAL_BOT_ROOM}')`,
          ),
        ).rejects.toThrow(/soko_bot_shared_room_owner_check/);
      });
    });

    it("joins only rooms of bots without an owner, even past the check", async () => {
      await withMigratedStub(async (tx) => {
        await tx.$executeRawUnsafe(
          `ALTER TABLE soko_bot DROP CONSTRAINT soko_bot_shared_room_owner_check`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO soko_bot VALUES (gen_random_uuid(), 'owner', NULL, '${WS_ORG1}', '${PERSONAL_BOT_ROOM}')`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO member VALUES ('m5', 'org1', 'dee')`,
        );

        expect(await roomsOf(tx, "dee")).toEqual([
          { roomId: SHARED_ROOM, access: "member" },
        ]);
      });
    });

    it("keeps an existing row as it is and adds nothing twice", async () => {
      await withMigratedStub(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO chat_room_user_member VALUES (gen_random_uuid(), '${SHARED_ROOM}', 'ben', 'guest', now())`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO member VALUES ('m2', 'org1', 'ben')`,
        );
        await tx.$executeRawUnsafe(`DELETE FROM member WHERE id = 'm2'`);
        await tx.$executeRawUnsafe(
          `INSERT INTO member VALUES ('m3', 'org1', 'ben')`,
        );

        expect(await roomsOf(tx, "ben")).toEqual([
          { roomId: SHARED_ROOM, access: "guest" },
        ]);
      });
    });

    it("joins nothing for an organization without shared rooms", async () => {
      await withMigratedStub(async (tx) => {
        await tx.$executeRawUnsafe(
          `INSERT INTO member VALUES ('m4', 'org3', 'cy')`,
        );

        expect(await roomsOf(tx, "cy")).toEqual([]);
        const [count] = await tx.$queryRawUnsafe<{ n: number }[]>(
          `SELECT count(*)::int AS n FROM chat_room_read_state WHERE "userId" = 'cy'`,
        );
        expect(count?.n).toBe(0);
      });
    });
  },
);

const REAL_ORG = `org-${randomUUID()}`;
const REAL_WS = randomUUID();
const REAL_ROOM = randomUUID();
const ANA = `ana-${randomUUID()}`;
const BEN = `ben-${randomUUID()}`;
const CY = `cy-${randomUUID()}`;

// The real schema with every trigger. `userId` is NOT NULL until the schema
// flip, so the transaction drops it to hold a shared bot, then rolls back.
async function withRealSharedRoom(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `ALTER TABLE soko_bot ALTER COLUMN "userId" DROP NOT NULL`,
        );
        for (const id of [ANA, BEN, CY]) {
          await tx.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
        }
        await tx.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${REAL_ORG}, 'Org', ${REAL_ORG})`;
        await tx.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${REAL_WS}::uuid, ${REAL_ORG}, now())`;
        await tx.$executeRaw`INSERT INTO chat_room (id, "organizationId", name, slug, kind, discoverability, "createdByUserId", "updatedAt") VALUES (${REAL_ROOM}::uuid, ${REAL_ORG}, 'Team Bot', 'team-bot', 'channel', 'public', ${ANA}, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "sharedRoomId", "updatedAt") VALUES (${randomUUID()}::uuid, NULL, ${REAL_WS}::uuid, ${REAL_ROOM}::uuid, now())`;
        // Ana and Ben join after the room exists, so the trigger adds them.
        for (const userId of [ANA, BEN]) {
          await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${userId}, ${REAL_ORG}, 'member', now())`;
        }
        await run(tx);
        throw new RollbackStub();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof RollbackStub)) throw error;
    });
}

async function inRealRoom(tx: Prisma.TransactionClient, userId: string) {
  const [row] = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM chat_room_user_member
    WHERE "roomId" = ${REAL_ROOM}::uuid AND "userId" = ${userId}`;
  return row?.n === 1;
}

describe.skipIf(!enabled)(
  "shared Soko Bot room join on the real schema",
  () => {
    it("joins a new member and refuses a bot row with an owner", async () => {
      await withRealSharedRoom(async (tx) => {
        await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${CY}, ${REAL_ORG}, 'member', now())`;
        expect(await inRealRoom(tx, CY)).toBe(true);

        await expect(
          tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "sharedRoomId", "updatedAt") VALUES (${randomUUID()}::uuid, ${ANA}, ${REAL_WS}::uuid, ${randomUUID()}::uuid, now())`,
        ).rejects.toThrow(/soko_bot_shared_room_owner_check/);
      });
    });

    it("takes a leaver out and puts them back when they rejoin", async () => {
      await withRealSharedRoom(async (tx) => {
        expect(await inRealRoom(tx, ANA)).toBe(true);
        expect(await inRealRoom(tx, BEN)).toBe(true);

        await tx.$executeRaw`DELETE FROM member WHERE "userId" = ${BEN} AND "organizationId" = ${REAL_ORG}`;
        expect(await inRealRoom(tx, BEN)).toBe(false);

        await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${BEN}, ${REAL_ORG}, 'member', now())`;
        expect(await inRealRoom(tx, BEN)).toBe(true);
      });
    });
  },
);

const BLOCKED_PROOF_MS = 300;

interface RaceIds {
  org: string;
  workspace: string;
  room: string;
  bot: string;
  owner: string;
  joiner: string;
}

function raceIds(): RaceIds {
  return {
    org: `org-${randomUUID()}`,
    workspace: randomUUID(),
    room: randomUUID(),
    bot: randomUUID(),
    owner: `owner-${randomUUID()}`,
    joiner: `joiner-${randomUUID()}`,
  };
}

function deferred() {
  let release!: () => void;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { done, release };
}

function stillPending(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(() => "finished"),
    new Promise((resolve) =>
      setTimeout(() => resolve("blocked"), BLOCKED_PROOF_MS),
    ),
  ]);
}

// Two real connections need committed fixtures, so this commits them and
// removes them after. Each cleanup step runs on its own, so a failing DELETE
// cannot skip the NOT NULL restore. NOT NULL comes back only if it was there.
async function withRaceFixtures(
  run: (
    ids: RaceIds,
    clientA: ReturnType<typeof createPrismaClient>,
    clientB: ReturnType<typeof createPrismaClient>,
  ) => Promise<void>,
) {
  if (!url || !db) throw new Error("Missing integration database");
  const scratch = db;
  const ids = raceIds();
  const clientA = createPrismaClient(url);
  const clientB = createPrismaClient(url);
  const [column] = await scratch.$queryRaw<{ is_nullable: string }[]>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'soko_bot' AND column_name = 'userId'`;
  const restoreNotNull = column?.is_nullable === "NO";
  const failures: unknown[] = [];
  const step = async (work: () => Promise<unknown>) => {
    try {
      await work();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    await scratch.$executeRawUnsafe(
      `ALTER TABLE soko_bot ALTER COLUMN "userId" DROP NOT NULL`,
    );
    for (const id of [ids.owner, ids.joiner]) {
      await scratch.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
    }
    await scratch.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${ids.org}, 'Race', ${ids.org})`;
    await scratch.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${ids.workspace}::uuid, ${ids.org}, now())`;
    await run(ids, clientA, clientB);
  } finally {
    await step(
      () =>
        scratch.$executeRaw`DELETE FROM soko_bot WHERE id = ${ids.bot}::uuid`,
    );
    if (restoreNotNull) {
      await step(() =>
        scratch.$executeRawUnsafe(
          `ALTER TABLE soko_bot ALTER COLUMN "userId" SET NOT NULL`,
        ),
      );
    }
    await step(
      () =>
        scratch.$executeRaw`DELETE FROM chat_room WHERE id = ${ids.room}::uuid`,
    );
    await step(
      () =>
        scratch.$executeRaw`DELETE FROM member WHERE "organizationId" = ${ids.org}`,
    );
    await step(
      () =>
        scratch.$executeRaw`DELETE FROM workspace WHERE id = ${ids.workspace}::uuid`,
    );
    await step(
      () => scratch.$executeRaw`DELETE FROM organization WHERE id = ${ids.org}`,
    );
    await step(
      () =>
        scratch.$executeRaw`DELETE FROM "user" WHERE id IN (${ids.owner}, ${ids.joiner})`,
    );
    await step(() => clientA.$disconnect());
    await step(() => clientB.$disconnect());
  }
  if (failures.length > 0) throw failures[0];
}

function insertMember(
  client: Prisma.TransactionClient | ReturnType<typeof createPrismaClient>,
  ids: RaceIds,
) {
  return client.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${ids.joiner}, ${ids.org}, 'member', now())`;
}

// Room creation (layer 15) must run READ COMMITTED: lock the organization
// FOR NO KEY UPDATE first, then read the members in a later statement.
describe.skipIf(!enabled)("shared Soko Bot room join under a race", () => {
  // Room creation locks first, a member joins during it: the trigger's
  // FOR SHARE holds the join until the room is committed, then joins it.
  it("holds a member insert until the room creation commits", async () => {
    await withRaceFixtures(async (ids, clientA, clientB) => {
      const locked = deferred();
      const gate = deferred();
      try {
        const creation = clientA.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 FROM organization WHERE id = ${ids.org} FOR NO KEY UPDATE`;
            locked.release();
            await gate.done;
            await tx.$executeRaw`INSERT INTO chat_room (id, "organizationId", name, slug, kind, discoverability, "createdByUserId", "updatedAt") VALUES (${ids.room}::uuid, ${ids.org}, 'Race Bot', 'race-bot', 'channel', 'public', ${ids.owner}, now())`;
            await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "sharedRoomId", "updatedAt") VALUES (${ids.bot}::uuid, NULL, ${ids.workspace}::uuid, ${ids.room}::uuid, now())`;
          },
          { timeout: 20000 },
        );
        await Promise.race([locked.done, creation]);

        const join = (async () => insertMember(clientB, ids))();
        const early = await stillPending(join);
        gate.release();
        await creation;
        await join;

        expect(early).toBe("blocked");
        const [row] = await clientA.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM chat_room_user_member
          WHERE "roomId" = ${ids.room}::uuid AND "userId" = ${ids.joiner}`;
        expect(row?.n).toBe(1);
      } finally {
        gate.release();
      }
    });
  }, 30000);

  // A member joins first and finds no room yet: the creation's lock waits
  // for that join to commit, and its later member read must see it. Under
  // REPEATABLE READ the snapshot is fixed by the lock statement, before the
  // join commits, so the read misses the member. Hence READ COMMITTED.
  it.each([
    { isolationLevel: "ReadCommitted" as const, seen: 1 },
    { isolationLevel: "RepeatableRead" as const, seen: 0 },
  ])(
    "a creation in $isolationLevel that waited for a join reads $seen new member",
    async ({ isolationLevel, seen }) => {
      await withRaceFixtures(async (ids, clientA, clientB) => {
        const inserted = deferred();
        const gate = deferred();
        try {
          const join = clientB.$transaction(
            async (tx) => {
              await insertMember(tx, ids);
              inserted.release();
              await gate.done;
            },
            { timeout: 20000 },
          );
          await Promise.race([inserted.done, join]);

          const creation = clientA.$transaction(
            async (tx) => {
              await tx.$queryRaw`SELECT 1 FROM organization WHERE id = ${ids.org} FOR NO KEY UPDATE`;
              const [row] = await tx.$queryRaw<{ n: number }[]>`
                SELECT count(*)::int AS n FROM member
                WHERE "organizationId" = ${ids.org} AND "userId" = ${ids.joiner}`;
              return row?.n;
            },
            { timeout: 20000, isolationLevel },
          );
          const early = await stillPending(creation);
          gate.release();
          await join;

          expect(early).toBe("blocked");
          expect(await creation).toBe(seen);
        } finally {
          gate.release();
        }
      });
    },
    30000,
  );
});
