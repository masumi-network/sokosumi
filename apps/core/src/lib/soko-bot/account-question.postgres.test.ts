import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { openAccountQuestion } from "./account-question";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const OWNER = `owner-${randomUUID()}`;
const WS = randomUUID();
const BOT = randomUUID();
const ROOM = randomUUID();
const OTHER_ROOM = randomUUID();
const A = randomUUID();
const B = randomUUID();
const HOUR = 60 * 60 * 1_000;

async function turnAt(
  at: Date,
  input: { status?: "COMPLETED" | "FAILED"; roomId?: string | null } = {},
) {
  return prisma.sokoBotTurn.create({
    data: {
      sokoBotId: BOT,
      workspaceId: WS,
      requestedByUserId: OWNER,
      source: "CHAT",
      status: input.status ?? "COMPLETED",
      clientTurnId: randomUUID(),
      userMessage: "Write an X post about our launch.",
      capabilityNames: [],
      finalAnswer: input.status === "FAILED" ? null : "Which account?",
      deadlineAt: new Date(at.getTime() + 60_000),
      destinationRoomId: input.roomId ?? null,
      createdAt: at,
    },
  });
}

async function askedOn(
  turn: { id: string; createdAt: Date; destinationRoomId: string | null },
  delivery?: "PUBLISHED" | "SUPPRESSED",
) {
  if (delivery && turn.destinationRoomId)
    await prisma.sokoBotDelivery.create({
      data: {
        turnId: turn.id,
        roomId: turn.destinationRoomId,
        destinationId: turn.destinationRoomId,
        status: delivery,
      },
    });
  return prisma.sokoBotAccountQuestion.create({
    data: {
      sokoBotId: BOT,
      turnId: turn.id,
      requestedByUserId: OWNER,
      destinationRoomId: turn.destinationRoomId,
      provider: "x",
      optionIds: [A, B],
      createdAt: turn.createdAt,
    },
  });
}

const scope = (now: Date, roomId: string | null = null) => ({
  sokoBotId: BOT,
  requestedByUserId: OWNER,
  destinationRoomId: roomId,
  turnId: randomUUID(),
  turnCreatedAt: now,
});

beforeAll(async () => {
  if (!enabled) return;
  await prisma.$executeRaw`INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (${OWNER}, ${OWNER}, ${`${OWNER}@fixture.invalid`}, true, now(), now())`;
  await prisma.$executeRaw`INSERT INTO workspace (id, "userId", "updatedAt") VALUES (${WS}::uuid, ${OWNER}, now())`;
  await prisma.$executeRaw`INSERT INTO soko_bot (id, "userId", "workspaceId", "updatedAt") VALUES (${BOT}::uuid, ${OWNER}, ${WS}::uuid, now())`;
});

afterAll(async () => {
  if (!enabled) return;
  await prisma.$executeRaw`DELETE FROM soko_bot WHERE id = ${BOT}::uuid`;
  await prisma.$executeRaw`DELETE FROM workspace WHERE id = ${WS}::uuid`;
  await prisma.$executeRaw`DELETE FROM "user" WHERE id = ${OWNER}`;
});

describe.skipIf(!enabled)("openAccountQuestion", () => {
  it("finds a delivered question from an earlier turn in the same chat, with its options in order", async () => {
    const now = new Date();
    const asked = await askedOn(await turnAt(new Date(now.getTime() - HOUR)));
    const open = await openAccountQuestion(scope(now));
    expect(open?.id).toBe(asked.id);
    await prisma.sokoBotAccountQuestion.delete({ where: { id: asked.id } });
  });

  it("leaves out a question not delivered, from another room, too old, or used by another turn", async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - HOUR);
    const failed = await askedOn(await turnAt(earlier, { status: "FAILED" }));
    const heldBack = await askedOn(
      await turnAt(earlier, { roomId: ROOM }),
      "SUPPRESSED",
    );
    const elsewhere = await askedOn(
      await turnAt(earlier, { roomId: OTHER_ROOM }),
      "PUBLISHED",
    );
    const old = await askedOn(
      await turnAt(new Date(now.getTime() - 25 * HOUR)),
    );
    const used = await askedOn(await turnAt(earlier));
    await prisma.sokoBotAccountQuestion.update({
      where: { id: used.id },
      data: { answeredTurnId: randomUUID() },
    });
    expect(await openAccountQuestion(scope(now))).toBeNull();
    expect(await openAccountQuestion(scope(now, ROOM))).toBeNull();
    // Delivered in its own room, it is open there and nowhere else.
    expect((await openAccountQuestion(scope(now, OTHER_ROOM)))?.id).toBe(
      elsewhere.id,
    );
    for (const question of [failed, heldBack, elsewhere, old, used])
      await prisma.sokoBotAccountQuestion.delete({
        where: { id: question.id },
      });
  });

  it("is never open on the turn that asked it", async () => {
    const now = new Date();
    const turn = await turnAt(new Date(now.getTime() - HOUR));
    const asked = await askedOn(turn);
    expect(
      await openAccountQuestion({ ...scope(now), turnId: turn.id }),
    ).toBeNull();
    await prisma.sokoBotAccountQuestion.delete({ where: { id: asked.id } });
  });
});
