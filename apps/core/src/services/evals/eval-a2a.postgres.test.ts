import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { A2A_SCENARIOS } from "@sokosumi/soko-bot";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { globalCoworkersFor } from "@/lib/evals/eval-guard";
import {
  EMPTY_COWORKER_RESPONSE,
  takeEvalCoworkerReply,
} from "@/lib/evals/fake-coworker";
import {
  SokoBotStartAbortedError,
  sokoBotControlPlane,
} from "@/services/soko-bot-control-plane.service";
import { deliverSokoBotEffect } from "@/services/soko-bot-effect-outbox.service";
import { expectCoreLog } from "@/test/core-log";
import { drainWaitUntil } from "@/test/wait-until";
import {
  A2A_DELIVERY_ATTEMPTS,
  a2aCaseScope,
  closeA2aWorld,
  endA2aCase,
  pollA2aChain,
  prepareA2aCase,
} from "./eval-a2a";
import { type EvalLaneRecord, ensureEvalLanes } from "./eval-lanes.service";
import { reconcileUnsettledCosts } from "./eval-runs.service";

const { failRealtime, cleanupSession } = vi.hoisted(() => ({
  failRealtime: { times: 0 },
  cleanupSession: { zone: undefined as string | undefined },
}));
vi.mock("@/lib/db/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/prisma")>();
  return {
    ...actual,
    default: new Proxy(actual.default, {
      get(target, key) {
        const zone = cleanupSession.zone;
        if (key === "$executeRaw" && zone) {
          return (
            ...args: Parameters<Prisma.TransactionClient["$executeRaw"]>
          ) => {
            cleanupSession.zone = undefined;
            return target.$transaction(async (tx) => {
              await tx.$queryRaw`SELECT set_config('TimeZone', ${zone}, true)`;
              return tx.$executeRaw(...args);
            });
          };
        }
        return Reflect.get(target, key, target);
      },
    }),
  };
});
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
  // The lanes' seeded world stays as other files expect it: each test's
  // messages in their rooms, the code's own included, go when it ends.
  let seededUntil = new Date(0);
  const laneOrganizations = async () =>
    (await prisma.evalLane.findMany({ select: { organizationId: true } })).map(
      (lane) => lane.organizationId,
    );
  beforeAll(async () => {
    await ensureEvalLanes(2);
    seededUntil = await databaseNow();
  });
  afterEach(async () => {
    await prisma.chatRoomMessage.deleteMany({
      where: {
        createdAt: { gt: seededUntil },
        room: { organizationId: { in: await laneOrganizations() } },
      },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(["UTC", "Europe/Berlin", "America/New_York"])(
    "ages only messages newer than the UTC hourly cutoff in %s",
    async (zone) => {
      const [lane] = await ensureEvalLanes(1);
      if (!lane) throw new Error("no lane");
      const now = await databaseNow();
      const recent = new Date(+now - 30 * 60_000);
      const older = new Date(+now - 90 * 60_000);
      const [recentId, olderId] = [randomUUID(), randomUUID()];
      const fixtures = { id: { in: [recentId, olderId] } };
      await prisma.chatRoomMessage.createMany({
        data: [
          { id: recentId, createdAt: recent },
          { id: olderId, createdAt: older },
        ].map((row) => ({
          ...row,
          roomId: lane.world.roomId,
          senderSokoBotId: lane.sokoBotId,
          content: "Previous case",
        })),
      });
      try {
        cleanupSession.zone = zone;
        await prepareA2aCase(lane, scenario("a2a-ask-and-relay"));
        const rows = await prisma.chatRoomMessage.findMany({ where: fixtures });
        expect(rows.find((row) => row.id === recentId)?.createdAt).toEqual(
          older,
        );
        expect(rows.find((row) => row.id === olderId)?.createdAt).toEqual(
          older,
        );
      } finally {
        cleanupSession.zone = undefined;
        await prisma.chatRoomMessage.deleteMany({ where: fixtures });
        await closeA2aWorld(lane);
      }
    },
  );

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

  it("ends a case as undelivered only on its own settled failures, and ending it closes only its messages", async () => {
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

      // Ending the case leaves nothing of it to publish into the next one,
      // and touches nothing that is not its own.
      await endA2aCase(step.turnIds);
      expect(await effectRow(asked.effectId)).toMatchObject({
        status: "SUPPRESSED",
        reason: "EVAL_CASE_ENDED",
        leaseUntil: null,
      });
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { nextAttemptAt: new Date(0) },
      });
      expect(await deliverSokoBotEffect(asked.effectId)).toBe(false);
      for (const id of [unrelated.effectId, elsewhere.effectId])
        expect(await effectRow(id)).toMatchObject({ status: "PERSISTED" });
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

  it("ends a case as undelivered when Mira's answer failed, not on her scripted silence or when the bot never asked", async () => {
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
      const mentionFails = (error: string) =>
        prisma.chatRoomMention.updateMany({
          where: { messageId: asked.messageId },
          data: { status: "failed", error },
        });

      // A script that answers nothing: her silence is the case, not a fault.
      await mentionFails(EMPTY_COWORKER_RESPONSE);
      expect((await poll(asked.turnId)).kind).not.toBe("undelivered");

      await mentionFails("dispatch threw");
      expect(await poll(asked.turnId)).toMatchObject({
        kind: "undelivered",
        detail: expect.stringContaining("dispatch threw"),
      });
      await prisma.chatRoomMention.updateMany({
        where: { messageId: asked.messageId },
        data: { error: null },
      });
      expect(await poll(asked.turnId)).toMatchObject({
        kind: "undelivered",
        detail: expect.stringContaining("no error recorded"),
      });
    } finally {
      await endCase(lane, coworkerId);
    }
  });
  it("scopes the case to Juno's answering turn: an unrelated Juno turn neither holds it open nor is cancelled", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const { coworkerId, asked, poll } = await askAndRelay(lane);
    const { junoId } = (
      await prepareA2aCase(lane, scenario("a2a-ask-and-relay"))
    ).a2a as { junoId: string };
    const juno = await prisma.sokoBot.findUniqueOrThrow({
      where: { id: junoId },
      select: { userId: true, workspaceId: true },
    });
    const junoTurn = (
      chatMentionId: string | null,
      status: "RUNNING" | "COMPLETED",
    ) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: junoId,
          requestedByUserId: juno.userId,
          workspaceId: juno.workspaceId,
          source: "CHAT",
          status,
          clientTurnId: randomUUID(),
          userMessage: "Answer the question",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          chatMentionId,
        },
      });
    const status = async (id: string) =>
      (
        await prisma.sokoBotTurn.findUniqueOrThrow({
          where: { id },
          select: { status: true },
        })
      ).status;
    try {
      await prisma.sokoBotEffectOutbox.update({
        where: { id: asked.effectId },
        data: { status: "PUBLISHED" },
      });
      await prisma.chatRoomMention.updateMany({
        where: { messageId: asked.messageId },
        data: { status: "responded" },
      });
      const mention = await prisma.chatRoomMention.create({
        data: {
          messageId: asked.messageId,
          sokoBotId: junoId,
          status: "responded",
        },
      });
      const answering = await junoTurn(mention.id, "COMPLETED");
      const unrelated = await junoTurn(null, "RUNNING");

      const scope = await a2aCaseScope([asked.turnId]);
      expect(scope.turnIds).toEqual([asked.turnId, answering.id]);
      // The finished case is not held open by Juno's other work.
      expect((await poll()).kind).toBe("done");

      // A late cancel settles before the case is read and charged.
      await prisma.sokoBotTurn.update({
        where: { id: answering.id },
        data: { status: "RUNNING" },
      });
      await prisma.chatRoomMention.update({
        where: { id: mention.id },
        data: { status: "sent" },
      });
      // A Prisma query runs only once awaited.
      const settleLater = setTimeout(() => {
        prisma.sokoBotTurn
          .update({
            where: { id: answering.id },
            data: { status: "CANCELLED" },
          })
          .then(() => undefined);
      }, 1_000);
      // Juno's reply mentions the bot, and the dispatch already under way
      // starts its answer meanwhile: the refreshed scope finds and cancels it.
      const reply = await prisma.chatRoomMessage.create({
        data: {
          roomId: lane.world.roomId,
          senderSokoBotId: junoId,
          content: "Asked about the EU plan",
        },
      });
      await prisma.sokoBotTurn.update({
        where: { id: answering.id },
        data: { chatResponseMessageId: reply.id },
      });
      const second = await prisma.chatRoomMention.create({
        data: {
          messageId: reply.id,
          sokoBotId: lane.sokoBotId,
          status: "pending",
        },
      });
      let late: { id: string } | null = null;
      const admitLater = setTimeout(() => {
        prisma.chatRoomMention
          .update({ where: { id: second.id }, data: { status: "sent" } })
          .then(() =>
            prisma.sokoBotTurn.create({
              data: {
                sokoBotId: lane.sokoBotId,
                requestedByUserId: lane.userId,
                workspaceId: lane.workspaceId,
                source: "CHAT",
                status: "RUNNING",
                clientTurnId: randomUUID(),
                userMessage: "Juno answered",
                capabilityNames: [],
                deadlineAt: new Date(Date.now() + 60_000),
                chatMentionId: second.id,
              },
            }),
          )
          .then((turn) => {
            late = turn;
          });
      }, 200);
      const stopAll = setTimeout(() => {
        prisma.sokoBotTurn
          .updateMany({
            where: {
              chatMentionId: { in: [mention.id, second.id] },
              status: { in: ["RUNNING", "CANCEL_REQUESTED"] },
            },
            data: { status: "CANCELLED" },
          })
          .then(() => undefined);
      }, 2_500);
      const end = await endA2aCase([asked.turnId], 10_000);
      clearTimeout(admitLater);
      clearTimeout(stopAll);
      expect(end.unsettled).toEqual([]);
      expect(late).not.toBeNull();
      expect(end.scope.turnIds).toEqual(
        expect.arrayContaining([asked.turnId, answering.id, late!.id]),
      );
      expect(end.scope.turnIds).not.toContain(unrelated.id);
      clearTimeout(settleLater);
      expect(await status(answering.id)).toBe("CANCELLED");
      // The sent mention is fenced, so a late answer cannot post.
      expect(
        await prisma.chatRoomMention.findUniqueOrThrow({
          where: { id: mention.id },
          select: { status: true },
        }),
      ).toEqual({ status: "failed" });
      expect(await status(unrelated.id)).toBe("RUNNING");

      // A turn that will not stop is reported, not waited for for ever.
      await prisma.sokoBotTurn.update({
        where: { id: answering.id },
        data: { status: "CANCEL_REQUESTED" },
      });
      expect((await endA2aCase([asked.turnId], 600)).unsettled).toEqual([
        answering.id,
      ]);
      await prisma.sokoBotTurn.updateMany({
        where: { id: { in: [answering.id, unrelated.id] } },
        data: { status: "CANCELLED" },
      });
    } finally {
      await endCase(lane, coworkerId);
    }
  }, 30_000);
  it("holds a finished run for a case's outliving turns, then charges all of them", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const turn = (
      costUsdMicros: bigint,
      status: "COMPLETED" | "CANCEL_REQUESTED",
    ) =>
      prisma.sokoBotTurn.create({
        data: {
          sokoBotId: lane.sokoBotId,
          requestedByUserId: lane.userId,
          workspaceId: lane.workspaceId,
          source: "CHAT",
          status,
          clientTurnId: randomUUID(),
          userMessage: "Fixture",
          capabilityNames: [],
          deadlineAt: new Date(Date.now() + 60_000),
          costUsdMicros,
        },
      });
    const first = await turn(BigInt(100), "COMPLETED");
    const late = await turn(BigInt(0), "CANCEL_REQUESTED");
    const run = await prisma.evalRun.create({
      data: { trigger: "MANUAL", repeats: 1, environment: "test" },
    });
    const result = (finishedAt: Date) =>
      prisma.evalResult.create({
        data: {
          runId: run.id,
          caseId: "a2a-ask-and-relay",
          suite: "soko-bot",
          repeat: 1,
          position: 0,
          status: "ERROR",
          finishedAt,
          costUsdMicros: BigInt(100),
          output: {
            infrastructure: { code: "case_unsettled" },
            unsettledTurnIds: [late.id],
            caseTurnIds: [first.id, late.id],
          },
        },
        select: { id: true },
      });
    const read = (id: string) =>
      prisma.evalResult.findUniqueOrThrow({
        where: { id },
        select: { costUsdMicros: true, output: true },
      });
    try {
      const recent = await result(new Date());
      // The recipient is still cancelling: the run waits.
      expect(await reconcileUnsettledCosts(run.id)).toBe(true);
      await prisma.sokoBotTurn.update({
        where: { id: late.id },
        data: { status: "CANCELLED", costUsdMicros: BigInt(250) },
      });
      expect(await reconcileUnsettledCosts(run.id)).toBe(false);
      expect(await read(recent.id)).toMatchObject({
        costUsdMicros: BigInt(350),
        output: expect.objectContaining({ costIncomplete: false }),
      });

      // One that never settles stops holding the run after the wait.
      await prisma.evalResult.delete({ where: { id: recent.id } });
      await prisma.sokoBotTurn.update({
        where: { id: late.id },
        data: { status: "CANCEL_REQUESTED" },
      });
      const stale = await result(new Date(Date.now() - 31 * 60_000));
      expect(await reconcileUnsettledCosts(run.id)).toBe(false);
      expect(await read(stale.id)).toMatchObject({
        output: expect.objectContaining({ costIncomplete: true }),
      });
    } finally {
      await prisma.evalRun.delete({ where: { id: run.id } });
      await prisma.sokoBotTurn.updateMany({
        where: { id: { in: [first.id, late.id] } },
        data: { status: "CANCELLED" },
      });
    }
  });

  it("starts no recipient turn for a mention the case already closed", async () => {
    const [lane] = await ensureEvalLanes(1);
    if (!lane) throw new Error("no lane");
    const question = await prisma.chatRoomMessage.create({
      data: {
        roomId: lane.world.roomId,
        senderUserId: lane.userId,
        content: "Can you check this?",
      },
    });
    const mention = await prisma.chatRoomMention.create({
      data: {
        messageId: question.id,
        sokoBotId: lane.sokoBotId,
        status: "failed",
        error: "The eval case ended",
      },
    });
    await expect(
      sokoBotControlPlane.startTurn({
        network: "mainnet",
        userId: lane.userId,
        workspaceId: lane.workspaceId,
        clientTurnId: randomUUID(),
        message: "Can you check this?",
        source: "CHAT",
        presetRoute: { route: "DIRECT_RESPONSE", reason: "fixture" },
        chat: { mentionId: mention.id },
      }),
    ).rejects.toThrow(
      new SokoBotStartAbortedError("The mention is no longer open"),
    );
    expect(
      await prisma.sokoBotTurn.count({ where: { chatMentionId: mention.id } }),
    ).toBe(0);
  });
});
