import { randomUUID } from "node:crypto";
import { A2A_SCENARIOS } from "@sokosumi/soko-bot";
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { globalCoworkersFor } from "@/lib/evals/eval-guard";
import { takeEvalCoworkerReply } from "@/lib/evals/fake-coworker";
import { deliverSokoBotEffect } from "@/services/soko-bot-effect-outbox.service";
import { expectCoreLog } from "@/test/core-log";
import { drainWaitUntil } from "@/test/wait-until";
import {
  A2A_DELIVERY_ATTEMPTS,
  closeA2aWorld,
  pollA2aChain,
  prepareA2aCase,
} from "./eval-a2a";
import { type EvalLaneRecord, ensureEvalLanes } from "./eval-lanes.service";

const { failRealtime } = vi.hoisted(() => ({ failRealtime: { times: 0 } }));
vi.mock("@/lib/ably/client", async () =>
  (await import("@/test/ably-client")).fakeAblyClientModule(),
);
vi.mock("@/helpers/chat-room-message-realtime", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/helpers/chat-room-message-realtime")
    >();
  return {
    ...actual,
    publishChatRoomMessageRealtimeById: async (
      ...args: Parameters<typeof actual.publishChatRoomMessageRealtimeById>
    ) => {
      if (failRealtime.times > 0) {
        failRealtime.times -= 1;
        throw new Error("realtime unavailable");
      }
      return actual.publishChatRoomMessageRealtimeById(...args);
    },
  };
});

function scenario(id: string) {
  const found = A2A_SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no scenario ${id}`);
  return found;
}

/**
 * A committed bot message, persisted but not yet published, from a turn of
 * its own: a question to Mira when `coworkerId` is given, else a plain message.
 */
async function persistedQuestion(
  lane: EvalLaneRecord,
  coworkerId: string | null,
) {
  // Asking her adds her to the room (`removeMira` takes her out again).
  if (coworkerId)
    await prisma.chatRoomCoworkerMember.upsert({
      where: { roomId_coworkerId: { roomId: lane.world.roomId, coworkerId } },
      create: { roomId: lane.world.roomId, coworkerId },
      update: {},
    });
  const room = await prisma.chatRoom.findUniqueOrThrow({
    where: { id: lane.world.roomId },
    include: {
      userMembers: { select: { userId: true } },
      coworkerMembers: { select: { coworkerId: true } },
      sokoBotMembers: { select: { sokoBotId: true } },
    },
  });
  const turn = await prisma.sokoBotTurn.create({
    data: {
      sokoBotId: lane.sokoBotId,
      requestedByUserId: lane.userId,
      workspaceId: lane.workspaceId,
      source: "CHAT",
      status: "COMPLETED",
      clientTurnId: randomUUID(),
      userMessage: "Ask Mira",
      finalAnswer: "Asked Mira",
      capabilityNames: [],
      deadlineAt: new Date(Date.now() + 60_000),
    },
  });
  const content = coworkerId
    ? "@Mira what does the EU plan cost per seat?"
    : "A note for the room";
  const message = await prisma.chatRoomMessage.create({
    data: { roomId: room.id, senderSokoBotId: lane.sokoBotId, content },
  });
  if (coworkerId)
    await prisma.chatRoomMention.create({
      data: { messageId: message.id, coworkerId, status: "pending" },
    });
  const receipt = await prisma.sokoBotToolCall.create({
    data: {
      turnId: turn.id,
      toolCallId: randomUUID(),
      capability: "post_chat",
      inputHash: "fixture",
      status: "COMPLETED",
      disposition: "APPLIED",
      verification: "LOCAL_TRANSACTION",
      targetId: message.id,
    },
  });
  const effect = await prisma.sokoBotEffectOutbox.create({
    data: {
      receiptId: receipt.id,
      purpose: "CHAT_MESSAGE",
      status: "PERSISTED",
      payload: {
        messageId: message.id,
        roomId: room.id,
        content,
        userIds: room.userMembers.map((m) => m.userId).sort(),
        coworkerIds: room.coworkerMembers.map((m) => m.coworkerId).sort(),
        botIds: room.sokoBotMembers.map((m) => m.sokoBotId).sort(),
      },
    },
  });
  return { turnId: turn.id, effectId: effect.id, messageId: message.id };
}

const removeMira = (lane: EvalLaneRecord, coworkerId: string) =>
  prisma.chatRoomCoworkerMember.deleteMany({
    where: { roomId: lane.world.roomId, coworkerId },
  });

const effectRow = (id: string) =>
  prisma.sokoBotEffectOutbox.findUniqueOrThrow({ where: { id } });

async function askAndRelay(lane: EvalLaneRecord) {
  const startedAt = new Date(Date.now() - 1_000);
  const state = await prepareA2aCase(lane, scenario("a2a-ask-and-relay"));
  const { coworkerId } = state.a2a as { coworkerId: string };
  const asked = await persistedQuestion(lane, coworkerId);
  const poll = () =>
    pollA2aChain({
      scenario: scenario("a2a-ask-and-relay"),
      firstTurnId: asked.turnId,
      lane,
      startedAt,
    });
  return { startedAt, coworkerId, asked, poll };
}

async function endCase(lane: EvalLaneRecord, coworkerId: string) {
  await prisma.sokoBotEffectOutbox.updateMany({
    where: {
      status: { in: ["PENDING", "PERSISTED"] },
      receipt: { turn: { workspaceId: lane.workspaceId } },
    },
    data: { status: "SUPPRESSED" },
  });
  await removeMira(lane, coworkerId);
  await closeA2aWorld(lane);
}

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

describe.skipIf(!enabled)("agent-to-agent eval world", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("gives a case Mira, Juno and Hannah's Task, and takes them away after", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const scenario = A2A_SCENARIOS.find(
      (candidate) => candidate.id === "a2a-ask-and-relay",
    );
    if (!scenario) throw new Error("no scenario");

    const state = await prepareA2aCase(lane, scenario);
    const { coworkerId, junoId } = state.a2a as {
      coworkerId: string;
      junoId: string;
    };
    const access = () =>
      prisma.coworkerWorkspaceAccess.findFirstOrThrow({
        where: { coworkerId, workspaceId: lane.workspaceId },
        select: { status: true },
      });
    const juno = () =>
      prisma.sokoBot.findUniqueOrThrow({
        where: { id: junoId },
        select: {
          proactivePaused: true,
          chatRoomMemberships: { select: { roomId: true } },
        },
      });
    expect((await access()).status).toBe("GRANTED");
    expect(await juno()).toMatchObject({
      proactivePaused: false,
      chatRoomMemberships: [{ roomId: lane.world.roomId }],
    });
    expect(
      await prisma.task.count({
        where: {
          workspaceId: lane.workspaceId,
          assigneeUserId: lane.world.hannahUserId,
          archivedAt: null,
        },
      }),
    ).toBe(1);
    // Her own workspace's Coworker, never a global one.
    expect(await globalCoworkersFor(lane.workspaceId)).toEqual([]);
    expect(await takeEvalCoworkerReply(coworkerId)).toContain("€25 per seat");

    await closeA2aWorld(lane);
    expect((await access()).status).toBe("REVOKED");
    expect(await juno()).toMatchObject({
      proactivePaused: true,
      chatRoomMemberships: [],
    });
    expect(
      await prisma.task.count({
        where: {
          workspaceId: lane.workspaceId,
          assigneeUserId: lane.world.hannahUserId,
          archivedAt: null,
        },
      }),
    ).toBe(0);
  });

  it("retries a persisted question to Mira from the case's own poll, and she answers once", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const { coworkerId, asked, poll } = await askAndRelay(lane);
    const answers = () =>
      prisma.chatRoomMessage.findMany({
        where: {
          roomId: lane.world.roomId,
          senderCoworkerId: coworkerId,
          deletedAt: null,
        },
        select: { content: true },
      });
    try {
      expectCoreLog("error", "A committed Soko Bot effect was not published");
      failRealtime.times = 1;
      expect(await deliverSokoBotEffect(asked.effectId)).toBe(false);
      expect(await effectRow(asked.effectId)).toMatchObject({
        status: "PERSISTED",
        attempts: 1,
        lastErrorCategory: "EFFECT_PUBLICATION_FAILED:realtime",
      });
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { nextAttemptAt: new Date(0) },
      });

      expect((await poll()).kind).not.toBe("undelivered");
      expect(await effectRow(asked.effectId)).toMatchObject({
        status: "PUBLISHED",
        attempts: 2,
      });
      expect(await drainWaitUntil()).toEqual([]);
      expect((await poll()).kind).not.toBe("undelivered");
      const replies = await answers();
      expect(replies).toHaveLength(1);
      expect(replies[0]?.content).toContain("€25 per seat");
    } finally {
      await endCase(lane, coworkerId);
    }
  });

  it("ends a case as undelivered only on its own settled failures, and closing it settles its messages", async () => {
    const [lane, otherLane] = await ensureEvalLanes(2);
    if (!lane || !otherLane) throw new Error("no lanes");
    const { coworkerId, asked, poll } = await askAndRelay(lane);
    // Due, failing work that is not this case's: another lane's message, and
    // a message of a turn in the same workspace that is not in the chain.
    const elsewhere = await persistedQuestion(otherLane, null);
    const unrelated = await persistedQuestion(lane, null);
    const failed = {
      attempts: A2A_DELIVERY_ATTEMPTS,
      lastErrorCategory: "EFFECT_PUBLICATION_FAILED:notifications",
      nextAttemptAt: new Date(Date.now() + 3_600_000),
    };
    try {
      await prisma.sokoBotEffectOutbox.update({
        where: { id: unrelated.effectId },
        data: failed,
      });
      await prisma.sokoBotEffectOutbox.update({
        where: { id: elsewhere.effectId },
        data: { nextAttemptAt: new Date(0) },
      });
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { ...failed, attempts: A2A_DELIVERY_ATTEMPTS - 1 },
      });
      expect((await poll()).kind).not.toBe("undelivered");
      expect(await effectRow(elsewhere.effectId)).toMatchObject({
        status: "PERSISTED",
        attempts: 0,
      });

      // The third attempt holds the lease: it may still succeed.
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: {
          attempts: A2A_DELIVERY_ATTEMPTS,
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });
      expect((await poll()).kind).not.toBe("undelivered");

      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { leaseToken: null, leaseUntil: null },
      });
      const step = await poll();
      expect(step).toMatchObject({
        kind: "undelivered",
        detail: expect.stringContaining(asked.effectId),
      });
      if (step.kind !== "undelivered") throw new Error("not undelivered");
      expect(step.turnIds).toContain(asked.turnId);
      expect(step.turnIds).not.toContain(unrelated.turnId);

      // Closing the case leaves nothing of it to publish into the next one.
      await closeA2aWorld(lane);
      for (const id of [asked.effectId, unrelated.effectId])
        expect(await effectRow(id)).toMatchObject({
          status: "SUPPRESSED",
          reason: "EVAL_CASE_CLOSED",
          leaseUntil: null,
        });
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { nextAttemptAt: new Date(0) },
      });
      expect(await deliverSokoBotEffect(asked.effectId)).toBe(false);
      expect(await effectRow(elsewhere.effectId)).toMatchObject({
        status: "PERSISTED",
      });
      expect(
        await prisma.chatRoomMention.findFirstOrThrow({
          where: { messageId: asked.messageId },
          select: { status: true },
        }),
      ).toEqual({ status: "failed" });
    } finally {
      await endCase(lane, coworkerId);
      await prisma.sokoBotEffectOutbox.update({
        where: { id: elsewhere.effectId },
        data: { status: "SUPPRESSED" },
      });
    }
  });

  it("ends a case as undelivered when Mira's scripted answer failed, not when the bot never asked", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const startedAt = new Date(Date.now() - 1_000);
    const state = await prepareA2aCase(lane, scenario("a2a-ask-and-relay"));
    const { coworkerId } = state.a2a as { coworkerId: string };
    const plain = await persistedQuestion(lane, null);
    const poll = (firstTurnId: string) =>
      pollA2aChain({
        scenario: scenario("a2a-ask-and-relay"),
        firstTurnId,
        lane,
        startedAt,
      });
    try {
      // Never asked: nothing undelivered, the checks score the bot.
      expect((await poll(plain.turnId)).kind).not.toBe("undelivered");

      const asked = await persistedQuestion(lane, coworkerId);
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { status: "PUBLISHED" },
      });
      await prisma.chatRoomMention.updateMany({
        where: { messageId: asked.messageId },
        data: { status: "failed", error: "dispatch threw" },
      });
      expect(await poll(asked.turnId)).toMatchObject({
        kind: "undelivered",
        detail: expect.stringContaining("dispatch threw"),
      });

      // Retries ran out: a dead letter is a delivery failure too.
      const exhausted = await persistedQuestion(lane, null);
      await prisma.sokoBotEffectOutbox.update({
        where: { id: exhausted.effectId },
        data: { status: "DEAD_LETTER", reason: "RETRY_EXHAUSTED" },
      });
      expect(await poll(exhausted.turnId)).toMatchObject({
        kind: "undelivered",
        detail: expect.stringContaining(exhausted.effectId),
      });
    } finally {
      await endCase(lane, coworkerId);
    }
  });
});
