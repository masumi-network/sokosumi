/**
 * What a chat tag sets off, against a real database: the push for a message
 * that asks something of a reader, the Contacts log for an external room, and
 * the open loops in the Soko Bot stand-up. Jev is scripted.
 */
import { randomUUID } from "node:crypto";
import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatSignalEvaluator } from "@/lib/chat-signals/jev-tagger";
import prisma from "@/lib/db/prisma";
import { tagRoomChatSignals } from "./chat-message-signals.service";
import { chatOpenLoopsBlock } from "./soko-bot-proactive.service";

vi.mock("@/lib/ably/publish", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ably/publish")>()),
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
const dana = randomUUID();
const organizationId = randomUUID();
const workspaceId = randomUUID();
const channelId = randomUUID();
const partnerId = randomUUID();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DANA_EMAIL = `dana-${dana}@partner.example`;

const TAGS = [
  "question",
  "needsDecision",
  "commitment",
  "blocker",
  "decisionMade",
  "fyi",
  "urgent",
  "chitChat",
  "workRequest",
  "escalation",
];

/** Jev, scripted by what each message says. */
const evaluate: ChatSignalEvaluator = async ({ state }) => {
  const messages = state.messages as { key: string; text: string }[];
  const answers: Record<string, unknown> = {};
  for (const { key, text } of messages) {
    const yes = (tag: string, probability: number) => {
      answers[`${key}_${tag}`] = { probability };
    };
    for (const tag of TAGS) yes(tag, 0.02);
    answers[`${key}_due`] = { choice: "NONE", probabilities: { NONE: 0.9 } };
    if (text.includes("pricing sheet") || text.includes("contract")) {
      yes("question", 0.95);
      answers[`${key}_addressee`] = {
        choice: "p0",
        probabilities: { p0: 0.9 },
      };
    } else if (text.includes("unacceptable")) {
      yes("escalation", 0.93);
      yes("urgent", 0.8);
    } else if (text.includes("lunch")) {
      yes("question", 0.65);
      answers[`${key}_addressee`] = {
        choice: "p0",
        probabilities: { p0: 0.9 },
      };
    } else {
      yes("fyi", 0.9);
    }
  }
  return { answers, costUsd: 0.00001 };
};

async function post(
  roomId: string,
  senderUserId: string,
  content: string,
  createdAt: Date,
): Promise<string> {
  const message = await prisma.chatRoomMessage.create({
    data: { roomId, senderUserId, content, createdAt },
  });
  await prisma.chatMessageSignal.create({
    data: { messageId: message.id, roomId, createdAt },
  });
  return message.id;
}

async function chatNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId, kind: "CHAT" },
    select: { eventId: true, messageKey: true },
  });
}

describe.runIf(enabled)("chat signal effects on PostgreSQL", () => {
  beforeAll(async () => {
    for (const [id, name, email] of [
      [alice, "Alice", `alice-${alice}@sokosumi.test`],
      [bob, "Bob", `bob-${bob}@sokosumi.test`],
      [dana, "Dana Partner", DANA_EMAIL],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name,
          email,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Effects test",
        slug: `effects-${organizationId}`,
      },
    });
    await prisma.member.createMany({
      data: [alice, bob].map((userId) => ({ userId, organizationId })),
    });
    await prisma.workspace.create({
      data: { id: workspaceId, organizationId },
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
        userMembers: { create: [alice, bob].map((userId) => ({ userId })) },
      },
    });
    await prisma.chatRoom.create({
      data: {
        id: partnerId,
        organizationId,
        name: "partner-dana",
        slug: `partner-${partnerId.slice(0, 8)}`,
        kind: "channel",
        discoverability: "external",
        createdByUserId: alice,
        userMembers: {
          create: [{ userId: alice }, { userId: dana, access: "guest" }],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.contact.deleteMany({ where: { workspaceId } });
    await prisma.chatRoom.deleteMany({
      where: { id: { in: [channelId, partnerId] } },
    });
    await prisma.workspace.deleteMany({ where: { id: workspaceId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [alice, bob, dana] } } });
  });

  it("tells the reader a fresh question asks something of, under their mention settings, once", async () => {
    const now = Date.now();
    const fresh = await post(
      channelId,
      bob,
      "Alice, can you send the pricing sheet before the call?",
      new Date(now - MINUTE),
    );
    const stale = await post(
      channelId,
      bob,
      "Alice, did the contract come back?",
      new Date(now - 4 * HOUR),
    );
    const unsure = await post(
      channelId,
      bob,
      "Alice, lunch at noon maybe?",
      new Date(now - MINUTE),
    );
    await post(channelId, bob, "FYI staging is down 2-4pm.", new Date(now));

    await tagRoomChatSignals(channelId, { source: "live", evaluate });

    // The fresh question pushes; one read hours late, or one Jev is not sure
    // enough of to interrupt for, only sorts.
    expect(await chatNotifications(alice)).toEqual([
      { eventId: fresh, messageKey: CHAT_MENTION_MESSAGE_KEY },
    ]);
    expect(await chatNotifications(bob)).toEqual([]);
    expect([stale, unsure]).not.toContain(fresh);

    // Tagging the same message again (an edit, a retry) adds nothing.
    await prisma.chatMessageSignal.update({
      where: { messageId: fresh },
      data: { state: "pending" },
    });
    await tagRoomChatSignals(channelId, { source: "live", evaluate });
    expect(await chatNotifications(alice)).toHaveLength(1);
  });

  it("logs an external room on the outside person's Contact: one entry a day, and each escalation", async () => {
    const now = Date.now();
    await post(partnerId, dana, "Thanks, the slides look good.", new Date(now));
    await post(partnerId, dana, "One more thing for later.", new Date(now));
    const escalation = await post(
      partnerId,
      dana,
      "This outage is unacceptable, we need it fixed today.",
      new Date(now),
    );
    await post(partnerId, alice, "We are on it.", new Date(now));

    await tagRoomChatSignals(partnerId, { source: "live", evaluate });

    const contacts = await prisma.contact.findMany({
      where: { workspaceId },
      select: {
        name: true,
        channels: { select: { value: true } },
        interactions: {
          select: { summary: true, sourceRef: true, direction: true },
          orderBy: { summary: "asc" },
        },
      },
    });
    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.name).toBe("Dana Partner");
    expect(contacts[0]?.channels.map((channel) => channel.value)).toContain(
      DANA_EMAIL,
    );
    expect(contacts[0]?.interactions).toEqual([
      expect.objectContaining({
        summary: "Chat in partner-dana",
        direction: "IN",
      }),
      expect.objectContaining({
        summary: expect.stringMatching(
          /^Escalation in partner-dana: This outage/,
        ),
        sourceRef: expect.stringContaining(escalation),
      }),
    ]);
    // The teammate's own messages log nothing, and no teammate becomes a contact.
    expect(
      await prisma.contactChannel.count({
        where: {
          contact: { workspaceId },
          value: { contains: "sokosumi.test" },
        },
      }),
    ).toBe(0);
  });

  it("puts the owner's open loops in the stand-up", async () => {
    const block = await chatOpenLoopsBlock(
      { userId: alice, workspaceId },
      new Date(),
    );
    expect(block[0]).toBe("## Open loops in chat");
    expect(block.join("\n")).toContain(
      'Unanswered question for you · Bob in launch: "Alice, did the contract come back?"',
    );
    // A question asked a minute ago is not a loop yet.
    expect(block.join("\n")).not.toContain("pricing sheet");
    expect(
      await chatOpenLoopsBlock({ userId: null, workspaceId }, new Date()),
    ).toEqual([]);
  });
});
