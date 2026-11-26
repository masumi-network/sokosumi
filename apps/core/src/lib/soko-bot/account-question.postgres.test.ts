import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "@/lib/db/prisma";
import { withFixtureSchemas } from "@/test/split-layout";
import { openAccountQuestion } from "./account-question";

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const OWNER = `owner-${randomUUID()}`;
const WS = randomUUID();
const BOT = randomUUID();
const ROOM = randomUUID();
const OTHER_ROOM = randomUUID();
let A = "";
let B = "";
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
  reason?: string,
) {
  if (delivery && turn.destinationRoomId)
    await prisma.sokoBotDelivery.create({
      data: {
        turnId: turn.id,
        roomId: turn.destinationRoomId,
        destinationId: turn.destinationRoomId,
        status: delivery,
        reason: reason ?? null,
      },
    });
  return prisma.sokoBotAccountQuestion.create({
    data: {
      sokoBotId: BOT,
      turnId: turn.id,
      requestedByUserId: OWNER,
      destinationRoomId: turn.destinationRoomId,
      provider: "x",
      // Stored after the order the accounts were connected in.
      optionIds: [B, A],
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

async function connect(
  tx: Prisma.TransactionClient,
  projectId: string,
  handle: string,
) {
  const key = `fixture-${randomUUID()}`;
  const connection = await tx.projectSocialConnection.create({
    data: {
      projectId,
      provider: "x",
      externalAccountId: key,
      externalHandle: handle,
      displayName: handle,
      composioConnectedAccountId: key,
      status: "active",
      activeExternalAccountKey: key,
      connectorUserId: OWNER,
      connectedAt: new Date(),
    },
  });
  return connection.id;
}

// Through the client, which knows which schema each table lives in, inside
// the fixture search path that the Project triggers still need.
beforeAll(async () => {
  if (!enabled) return;
  await withFixtureSchemas(async (tx) => {
    await tx.user.create({
      data: {
        id: OWNER,
        name: OWNER,
        email: `${OWNER}@fixture.invalid`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await tx.workspace.create({ data: { id: WS, userId: OWNER } });
    await tx.sokoBot.create({
      data: { id: BOT, userId: OWNER, workspaceId: WS },
    });
    const company = await tx.project.create({
      data: { workspaceId: WS, name: "Company marketing" },
    });
    const founder = await tx.project.create({
      data: { workspaceId: WS, name: "Founder notes" },
    });
    A = await connect(tx, company.id, "acme_hq");
    B = await connect(tx, founder.id, "pat");
  });
});

afterAll(async () => {
  if (!enabled) return;
  await withFixtureSchemas(async (tx) => {
    await tx.projectSocialConnection.deleteMany({
      where: { id: { in: [A, B] } },
    });
    await tx.project.deleteMany({ where: { workspaceId: WS } });
    await tx.sokoBot.deleteMany({ where: { id: BOT } });
    await tx.workspace.deleteMany({ where: { id: WS } });
    await tx.user.deleteMany({ where: { id: OWNER } });
  });
});

describe.skipIf(!enabled)("openAccountQuestion", () => {
  it("finds a delivered question from an earlier turn in the same chat, with its options in the stored order", async () => {
    const now = new Date();
    const asked = await askedOn(await turnAt(new Date(now.getTime() - HOUR)));
    const open = await openAccountQuestion(scope(now));
    expect(open?.id).toBe(asked.id);
    expect(open?.options.map((option) => option.id)).toEqual([B, A]);
    expect(open?.options.map((option) => option.project.name)).toEqual([
      "Founder notes",
      "Company marketing",
    ]);
    await prisma.sokoBotAccountQuestion.delete({ where: { id: asked.id } });
  });

  it("is open after the Personal Assistant page showed the reply (its room delivery suppressed for that page)", async () => {
    const now = new Date();
    const asked = await askedOn(
      await turnAt(new Date(now.getTime() - HOUR), { roomId: ROOM }),
      "SUPPRESSED",
      "ASSISTANT_PAGE",
    );
    expect((await openAccountQuestion(scope(now, ROOM)))?.id).toBe(asked.id);
    await prisma.sokoBotAccountQuestion.delete({ where: { id: asked.id } });
  });

  it("holds one question per asking turn and provider", async () => {
    const turn = await turnAt(new Date(Date.now() - HOUR));
    const asked = await askedOn(turn);
    await expect(askedOn(turn)).rejects.toMatchObject({ code: "P2002" });
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
