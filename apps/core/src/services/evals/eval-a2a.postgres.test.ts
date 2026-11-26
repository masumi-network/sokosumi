import { randomUUID } from "node:crypto";
import { A2A_SCENARIOS } from "@sokosumi/soko-bot";
import { afterAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { globalCoworkersFor } from "@/lib/evals/eval-guard";
import { takeEvalCoworkerReply } from "@/lib/evals/fake-coworker";
import {
  deliverSokoBotEffect,
  syncSokoBotEffects,
} from "@/services/soko-bot-effect-outbox.service";
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

/** The bot's committed question to Mira, persisted but not yet published. */
async function persistedQuestion(lane: EvalLaneRecord, coworkerId: string) {
  // Asking her adds her to the room (`removeMira` takes her out again).
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
  const content = "@Mira what does the EU plan cost per seat?";
  const message = await prisma.chatRoomMessage.create({
    data: { roomId: room.id, senderSokoBotId: lane.sokoBotId, content },
  });
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

const drain = (lane: EvalLaneRecord) =>
  syncSokoBotEffects({
    shouldContinue: () => true,
    abortSignal: new AbortController().signal,
    workspaceIds: [lane.workspaceId],
  });

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

  it("gets a persisted question to Mira after one publication retry, and she answers once", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const state = await prepareA2aCase(lane, scenario("a2a-ask-and-relay"));
    const { coworkerId } = state.a2a as { coworkerId: string };
    const asked = await persistedQuestion(lane, coworkerId);
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
      expect(
        await prisma.sokoBotEffectOutbox.findUniqueOrThrow({
          where: { id: asked.effectId },
        }),
      ).toMatchObject({
        status: "PERSISTED",
        attempts: 1,
        lastErrorCategory: "EFFECT_PUBLICATION_FAILED:realtime",
      });
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { nextAttemptAt: new Date(0) },
      });

      expect(await drain(lane)).toBe(1);
      expect(await drain(lane)).toBe(0);
      expect(
        await prisma.sokoBotEffectOutbox.findUniqueOrThrow({
          where: { id: asked.effectId },
        }),
      ).toMatchObject({ status: "PUBLISHED", attempts: 2 });
      expect(await drainWaitUntil()).toEqual([]);
      const replies = await answers();
      expect(replies).toHaveLength(1);
      expect(replies[0]?.content).toContain("€25 per seat");
    } finally {
      await removeMira(lane, coworkerId);
      await closeA2aWorld(lane);
    }
  });

  it("stops an agent-to-agent case as undelivered once a chat effect keeps failing", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
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
    try {
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: {
          attempts: A2A_DELIVERY_ATTEMPTS - 1,
          lastErrorCategory: "EFFECT_PUBLICATION_FAILED:notifications",
        },
      });
      expect((await poll()).kind).toBe("waiting");
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { attempts: A2A_DELIVERY_ATTEMPTS },
      });
      expect(await poll()).toMatchObject({
        kind: "undelivered",
        detail: expect.stringContaining(asked.effectId),
      });
    } finally {
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { status: "SUPPRESSED" },
      });
      await removeMira(lane, coworkerId);
      await closeA2aWorld(lane);
    }
  });
});
