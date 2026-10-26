/**
 * Chat signals against a real database: the batch tagger's leases and
 * writes, the sweep behind it, and every read built on the stored tags
 * (needs-you counts, catch-up, decisions, open loops, corrections, the
 * cached summary). Jev and the summary model are scripted.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatSignalEvaluator } from "@/lib/chat-signals/jev-tagger";
import prisma from "@/lib/db/prisma";
import type { SyncExecutionContext } from "@/routes/sync/handler";
import {
  type ChatSummaryDeps,
  getChatCatchUpSummary,
} from "./chat-catch-up-summary.service";
import {
  sweepChatMessageSignals,
  tagRoomChatSignals,
} from "./chat-message-signals.service";
import {
  correctChatMessageSignal,
  getChatRoomCatchUp,
  getChatRoomNeedsYouCounts,
  listChatNeedsYou,
  listChatOpenLoops,
  listChatRoomMessagesWithTag,
  setChatMessageSignalLoop,
} from "./chat-signal-views.service";

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn().mockResolvedValue(undefined),
}));

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");

const alice = randomUUID();
const bob = randomUUID();
const carla = randomUUID();
const organizationId = randomUUID();
const channelId = randomUUID();
const HOUR = 60 * 60 * 1000;
const now = Date.now();

/** Jev, scripted by what each message says. */
const evaluate: ChatSignalEvaluator = async ({ state }) => {
  const messages = state.messages as { key: string; text: string }[];
  const answers: Record<string, unknown> = {};
  for (const { key, text } of messages) {
    const yes = (tag: string, probability: number) => {
      answers[`${key}_${tag}`] = { probability };
    };
    for (const tag of [
      "question",
      "needsDecision",
      "commitment",
      "blocker",
      "decisionMade",
      "fyi",
      "urgent",
      "chitChat",
      "workRequest",
    ]) {
      yes(tag, 0.02);
    }
    answers[`${key}_due`] = { choice: "NONE", probabilities: { NONE: 0.9 } };
    if (text.includes("pricing sheet")) {
      yes("question", 0.97);
      // Bob wrote it; Jev picks Alice, the first person besides him.
      answers[`${key}_addressee`] = {
        choice: "p0",
        probabilities: { p0: 0.9 },
      };
    } else if (text.startsWith("Decided")) {
      yes("decisionMade", 0.98);
    } else if (text.startsWith("I'll send")) {
      yes("commitment", 0.97);
      answers[`${key}_due`] = {
        choice: "TODAY",
        probabilities: { TODAY: 0.9 },
      };
    } else {
      yes("fyi", 0.9);
    }
  }
  return {
    answers,
    costUsd: 0.00001,
  };
};

const context: SyncExecutionContext = {
  abortSignal: new AbortController().signal,
  deadlineMs: Date.now() + 60_000,
  msRemaining: () => 60_000,
  shouldContinue: () => true,
};

async function postMessage(
  senderUserId: string,
  content: string,
  createdAt: Date,
): Promise<string> {
  const message = await prisma.chatRoomMessage.create({
    data: { roomId: channelId, senderUserId, content, createdAt },
  });
  await prisma.chatMessageSignal.create({
    data: { messageId: message.id, roomId: channelId, createdAt },
  });
  return message.id;
}

describe.runIf(enabled)("chat signals on PostgreSQL", () => {
  let question: string;
  let decision: string;
  let commitment: string;

  beforeAll(async () => {
    for (const [id, name] of [
      [alice, "Alice"],
      [bob, "Bob"],
      [carla, "Carla"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name,
          email: `signals-${id}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Signals test",
        slug: `signals-${organizationId}`,
      },
    });
    await prisma.member.createMany({
      data: [alice, bob, carla].map((userId) => ({ userId, organizationId })),
    });
    await prisma.chatRoom.create({
      data: {
        id: channelId,
        organizationId,
        name: "launch",
        slug: `launch-${channelId.slice(0, 8)}`,
        kind: "channel",
        discoverability: "public",
        createdByUserId: alice,
        userMembers: {
          create: [alice, bob, carla].map((userId) => ({ userId })),
        },
        readStates: {
          create: [alice, bob, carla].map((userId) => ({
            userId,
            lastReadAt: new Date(now - 7 * 24 * HOUR),
            createdAt: new Date(now - 30 * 24 * HOUR),
          })),
        },
      },
    });
    question = await postMessage(
      bob,
      "Alice, can you send the pricing sheet before the call?",
      new Date(now - 5 * HOUR),
    );
    decision = await postMessage(
      carla,
      "Decided: we launch Monday with the reduced set.",
      new Date(now - 4 * HOUR),
    );
    commitment = await postMessage(
      alice,
      "I'll send the press kit to the agency today.",
      new Date(now - 3 * 24 * HOUR),
    );
  });

  afterAll(async () => {
    await prisma.chatRoom.deleteMany({ where: { id: channelId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice, bob, carla] } },
    });
  });

  it("tags a room's pending messages in one batch and stores who they ask", async () => {
    const calls = vi.fn(evaluate);
    const outcome = await tagRoomChatSignals(channelId, {
      source: "live",
      evaluate: calls,
    });
    expect(outcome).toMatchObject({ claimed: 3, tagged: 3 });
    expect(calls).toHaveBeenCalledOnce();

    const stored = await prisma.chatMessageSignal.findUniqueOrThrow({
      where: { messageId: question },
    });
    expect(stored).toMatchObject({
      state: "tagged",
      lease: null,
      addressedUserIds: [alice],
      model: "typesafe-ai/jev",
    });
    const committed = await prisma.chatMessageSignal.findUniqueOrThrow({
      where: { messageId: commitment },
    });
    // TODAY, counted from when it was said: three days ago, so overdue.
    expect(committed.commitmentDueAt?.getTime()).toBeLessThan(now);

    // A second flush finds nothing left to claim.
    expect(
      await tagRoomChatSignals(channelId, { source: "live", evaluate: calls }),
    ).toMatchObject({ claimed: 0 });
  });

  it("counts what needs each reader, until they read the room", async () => {
    expect(await getChatRoomNeedsYouCounts([channelId], alice)).toEqual(
      new Map([[channelId, 1]]),
    );
    expect(await getChatRoomNeedsYouCounts([channelId], carla)).toEqual(
      new Map(),
    );
    const needsYou = await listChatNeedsYou(alice, organizationId);
    expect(needsYou.map((item) => item.message.id)).toEqual([question]);
  });

  it("buckets the catch-up line, one bucket per unread message", async () => {
    const catchUp = await getChatRoomCatchUp(channelId, alice);
    expect(catchUp).toMatchObject({ unreadCount: 2, taggedCount: 2 });
    expect(catchUp.buckets).toEqual([
      { bucket: "needsYou", count: 1, messageIds: [question] },
      { bucket: "decisionMade", count: 1, messageIds: [decision] },
    ]);
  });

  it("lists decisions, and a correction takes one out for everyone", async () => {
    const page = await listChatRoomMessagesWithTag(
      channelId,
      bob,
      "decisionMade",
      { take: 10 },
    );
    expect(page.messages.map((message) => message.id)).toEqual([decision]);

    await correctChatMessageSignal({
      messageId: decision,
      userId: bob,
      tag: "decisionMade",
      applies: false,
    });
    expect(
      (
        await listChatRoomMessagesWithTag(channelId, carla, "decisionMade", {
          take: 10,
        })
      ).messages,
    ).toEqual([]);

    await correctChatMessageSignal({
      messageId: decision,
      userId: bob,
      tag: "decisionMade",
      applies: true,
    });
    expect(
      await prisma.chatMessageSignalCorrection.count({
        where: { signal: { messageId: decision } },
      }),
    ).toBe(1);
  });

  it("finds open loops: an unanswered question and an overdue commitment", async () => {
    const loops = await listChatOpenLoops(alice, organizationId);
    expect(loops.map((loop) => [loop.kind, loop.message.id]).sort()).toEqual(
      [
        ["commitment", commitment],
        ["question", question],
      ].sort(),
    );

    await setChatMessageSignalLoop({
      messageId: commitment,
      userId: alice,
      workspaceId: randomUUID(),
      closed: true,
    });
    // Alice answers in the channel: the question is no longer open.
    await prisma.chatRoomMessage.create({
      data: {
        roomId: channelId,
        senderUserId: alice,
        content: "Sent it just now.",
      },
    });
    expect(await listChatOpenLoops(alice, organizationId)).toEqual([]);
  });

  it("writes the summary once and reuses it until a new tagged message", async () => {
    const generate = vi.fn<ChatSummaryDeps["generate"]>(async () => ({
      text: JSON.stringify({
        headline: "Bob needs the pricing sheet; launch is Monday.",
        rooms: [{ room: "r0", line: "Pricing sheet wanted, launch Monday." }],
      }),
      costUsd: 0.0001,
    }));
    const first = await getChatCatchUpSummary(
      { userId: alice, organizationId, roomId: null },
      { generate },
    );
    expect(first.headline).toBe(
      "Bob needs the pricing sheet; launch is Monday.",
    );
    expect(first.rooms).toEqual([
      {
        roomId: channelId,
        roomName: "launch",
        line: "Pricing sheet wanted, launch Monday.",
      },
    ]);
    expect(first.needsYou.map((item) => item.messageId)).toEqual([question]);
    expect(first.counts).toEqual([
      { bucket: "needsYou", count: 1 },
      { bucket: "decisionMade", count: 1 },
    ]);
    expect(first.decisions.map((item) => item.messageId)).toEqual([decision]);
    // The prompt carries no ids, only room keys, authors, labels and text.
    expect(generate.mock.calls[0][0].prompt).not.toContain(channelId);

    await getChatCatchUpSummary(
      { userId: alice, organizationId, roomId: null },
      { generate },
    );
    expect(generate).toHaveBeenCalledOnce();

    await postMessage(
      carla,
      "The staging environment is down for maintenance this afternoon.",
      new Date(),
    );
    await tagRoomChatSignals(channelId, { source: "live", evaluate });
    await getChatCatchUpSummary(
      { userId: alice, organizationId, roomId: null },
      { generate },
    );
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("sweeps a lease a crashed batch left, and fails rows out of attempts", async () => {
    const stuck = await postMessage(
      bob,
      "Heads up: the brand guidelines moved to the shared drive.",
      new Date(now - HOUR),
    );
    await prisma.chatMessageSignal.update({
      where: { messageId: stuck },
      data: {
        state: "running",
        lease: randomUUID(),
        attempts: 1,
        availableAt: new Date(now - 1_000),
      },
    });
    await sweepChatMessageSignals(context, { evaluate });
    expect(
      await prisma.chatMessageSignal.findUniqueOrThrow({
        where: { messageId: stuck },
      }),
    ).toMatchObject({ state: "tagged", lease: null, attempts: 2 });

    const doomed = await postMessage(
      bob,
      "One more update for everyone about the launch checklist.",
      new Date(now - HOUR),
    );
    await prisma.chatMessageSignal.update({
      where: { messageId: doomed },
      data: {
        state: "running",
        lease: randomUUID(),
        attempts: 3,
        availableAt: new Date(now - 1_000),
      },
    });
    await sweepChatMessageSignals(context, { evaluate });
    expect(
      await prisma.chatMessageSignal.findUniqueOrThrow({
        where: { messageId: doomed },
      }),
    ).toMatchObject({ state: "failed", lease: null });
  });

  it("hands rows back when Jev fails, without tagging them", async () => {
    const message = await postMessage(
      carla,
      "Reminder that the quarterly review deck is due next week.",
      new Date(),
    );
    const failing: ChatSignalEvaluator = async () => {
      throw new Error("gateway down");
    };
    const outcome = await tagRoomChatSignals(channelId, {
      source: "live",
      evaluate: failing,
    });
    expect(outcome).toMatchObject({ claimed: 1, tagged: 0 });
    const row = await prisma.chatMessageSignal.findUniqueOrThrow({
      where: { messageId: message },
    });
    expect(row).toMatchObject({ state: "pending", lease: null, attempts: 1 });
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  });
});
