import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  type SokoBotLiveness,
  sokoBotForTurnMember,
} from "./soko-bot-turn-authority";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const ORG_WS = randomUUID();
const PERSONAL_WS = randomUUID();
const PERSONAL_BOT = randomUUID();
const SHARED_BOT = randomUUID();
const ORPHAN_SHARED_BOT = randomUUID();
const OWNER = `owner-${randomUUID()}`;
const MEMBER = `member-${randomUUID()}`;
const OUTSIDER = `outsider-${randomUUID()}`;
const ORG = `org-${randomUUID()}`;

class Rollback extends Error {}

// Opt-in real Postgres proof of the where the resolver sends. `userId` is
// still NOT NULL until the schema flip, so the transaction drops it to hold a
// shared row, then rolls everything back.
async function withFixtures(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `ALTER TABLE soko_bot ALTER COLUMN "userId" DROP NOT NULL`,
        );
        for (const id of [OWNER, MEMBER, OUTSIDER]) {
          await tx.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${id}, ${id}, ${`${id}@fixture.invalid`}, true, now(), now())`;
        }
        await tx.$executeRaw`INSERT INTO organization (id, name, slug) VALUES (${ORG}, 'Org', ${ORG})`;
        for (const userId of [OWNER, MEMBER]) {
          await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId", role, "createdAt") VALUES (${randomUUID()}, ${userId}, ${ORG}, 'member', now())`;
        }
        await tx.$executeRaw`INSERT INTO workspace (id, "organizationId", "updatedAt") VALUES (${ORG_WS}::uuid, ${ORG}, now())`;
        await tx.$executeRaw`INSERT INTO workspace (id, "userId", "updatedAt") VALUES (${PERSONAL_WS}::uuid, ${MEMBER}, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${PERSONAL_BOT}::uuid, ${OWNER}, ${ORG_WS}::uuid, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${SHARED_BOT}::uuid, NULL, ${ORG_WS}::uuid, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${ORPHAN_SHARED_BOT}::uuid, NULL, ${PERSONAL_WS}::uuid, now())`;
        await run(tx);
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

async function reaches(
  tx: Prisma.TransactionClient,
  sokoBotId: string,
  userId: string,
  workspaceId = ORG_WS,
  liveness: SokoBotLiveness = "running",
): Promise<boolean> {
  const bot = await sokoBotForTurnMember(
    { sokoBotId, userId, workspaceId },
    liveness,
    tx,
  );
  return bot !== null;
}

describe.skipIf(!enabled)("sokoBotForTurnMember against PostgreSQL", () => {
  it("lets the owner reach their personal bot and refuses everyone else", async () => {
    await withFixtures(async (tx) => {
      expect(await reaches(tx, PERSONAL_BOT, OWNER)).toBe(true);
      expect(await reaches(tx, PERSONAL_BOT, MEMBER)).toBe(false);
      expect(await reaches(tx, PERSONAL_BOT, OUTSIDER)).toBe(false);
    });
  });

  it("lets a member reach a shared bot and refuses a non-member", async () => {
    await withFixtures(async (tx) => {
      expect(await reaches(tx, SHARED_BOT, MEMBER)).toBe(true);
      expect(await reaches(tx, SHARED_BOT, OWNER)).toBe(true);
      expect(await reaches(tx, SHARED_BOT, OUTSIDER)).toBe(false);
    });
  });

  it("refuses a member who left the Organization", async () => {
    await withFixtures(async (tx) => {
      await tx.$executeRaw`DELETE FROM member WHERE "userId" = ${MEMBER}`;
      expect(await reaches(tx, SHARED_BOT, MEMBER)).toBe(false);
    });
  });

  it("refuses a shared bot outside an Organization workspace", async () => {
    await withFixtures(async (tx) => {
      expect(await reaches(tx, ORPHAN_SHARED_BOT, MEMBER, PERSONAL_WS)).toBe(
        false,
      );
    });
  });

  it("refuses a turn in another workspace than the bot's", async () => {
    await withFixtures(async (tx) => {
      expect(await reaches(tx, SHARED_BOT, MEMBER, PERSONAL_WS)).toBe(false);
    });
  });

  it("refuses an archived or paused bot", async () => {
    await withFixtures(async (tx) => {
      await tx.$executeRaw`UPDATE soko_bot SET status = 'PAUSED' WHERE id = ${SHARED_BOT}::uuid`;
      expect(await reaches(tx, SHARED_BOT, MEMBER)).toBe(false);
      expect(await reaches(tx, SHARED_BOT, MEMBER, ORG_WS, "notArchived")).toBe(
        true,
      );
      await tx.$executeRaw`UPDATE soko_bot SET "archivedAt" = now() WHERE id = ${SHARED_BOT}::uuid`;
      expect(await reaches(tx, SHARED_BOT, MEMBER, ORG_WS, "notArchived")).toBe(
        false,
      );
    });
  });
});
