import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import { contextPacketScope } from "./context-packet-scope";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const OWNER = `owner-${randomUUID()}`;
const WS = randomUUID();
const BOT = randomUUID();
const ROOM = randomUUID();
const OTHER_ROOM = randomUUID();

class Rollback extends Error {}

async function withFixtures(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${OWNER}, ${OWNER}, ${`${OWNER}@fixture.invalid`}, true, now(), now())`;
        await tx.$executeRaw`INSERT INTO workspace (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
        await tx.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
        await run(tx);
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

async function postedTurn(
  tx: Prisma.TransactionClient,
  input: {
    source: "INGEST" | "SCHEDULE" | "CHAT";
    finalAnswer: string;
    roomId: string;
    delivery: "PUBLISHED" | "SUPPRESSED";
  },
) {
  const turn = await tx.sokoBotTurn.create({
    data: {
      sokoBotId: BOT,
      workspaceId: WS,
      requestedByUserId: OWNER,
      source: input.source,
      status: "COMPLETED",
      clientTurnId: randomUUID(),
      userMessage: "system prompt",
      capabilityNames: [],
      finalAnswer: input.finalAnswer,
      deadlineAt: new Date(Date.now() + 60_000),
      destinationRoomId: input.roomId,
    },
  });
  await tx.sokoBotDelivery.create({
    data: {
      turnId: turn.id,
      roomId: input.roomId,
      destinationId: input.roomId,
      status: input.delivery,
    },
  });
}

describe.skipIf(!enabled)("recent turns in a room", () => {
  it("include what the bot posted there on its own, and nothing it held back", async () => {
    await withFixtures(async (tx) => {
      await postedTurn(tx, {
        source: "INGEST",
        finalAnswer: "Make — s_New_Registration: two errors",
        roomId: ROOM,
        delivery: "PUBLISHED",
      });
      await postedTurn(tx, {
        source: "SCHEDULE",
        finalAnswer: "Nothing to add.",
        roomId: ROOM,
        delivery: "SUPPRESSED",
      });
      await postedTurn(tx, {
        source: "INGEST",
        finalAnswer: "Posted in another room",
        roomId: OTHER_ROOM,
        delivery: "PUBLISHED",
      });
      // An assistant-page turn has no mention, but it was never in this room.
      await postedTurn(tx, {
        source: "CHAT",
        finalAnswer: "Answered on the assistant page",
        roomId: OTHER_ROOM,
        delivery: "PUBLISHED",
      });

      const scope = contextPacketScope({
        userId: OWNER,
        sokoBotId: BOT,
        workspaceId: WS,
        roomId: ROOM,
        sharedScope: null,
      });
      const turns = await tx.sokoBotTurn.findMany({
        where: scope.recentTurnWhere,
        select: { finalAnswer: true },
      });
      expect(turns.map((turn) => turn.finalAnswer)).toEqual([
        "Make — s_New_Registration: two errors",
      ]);
    });
  });
});
