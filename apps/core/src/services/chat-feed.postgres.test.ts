/**
 * The Feed against a real database: which messages need the viewer, the
 * position cursor, and the unread count. Signals are written straight to
 * the store, so Jev does not run.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { listChatFeed } from "./chat-feed.service";

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
const workspaceId = randomUUID();
const botId = randomUUID();
const channelId = randomUUID();
const mutedChannelId = randomUUID();
const bobDirectId = randomUUID();
const botDirectId = randomUUID();
const MINUTE = 60 * 1000;
const start = Date.now() - 60 * MINUTE;
const at = (minute: number) => new Date(start + minute * MINUTE);

async function message(input: {
  roomId: string;
  minute: number;
  senderUserId?: string;
  senderSokoBotId?: string;
  mentions?: string[];
  deletedAt?: Date;
}): Promise<string> {
  const created = await prisma.chatRoomMessage.create({
    data: {
      roomId: input.roomId,
      senderUserId: input.senderUserId ?? null,
      senderSokoBotId: input.senderSokoBotId ?? null,
      content: `message at ${input.minute}`,
      createdAt: at(input.minute),
      deletedAt: input.deletedAt ?? null,
      userMentionsAsSource: {
        create: (input.mentions ?? []).map((userId) => ({ userId })),
      },
    },
  });
  return created.id;
}

/** A message Jev read as a question addressed to `addressee`. */
async function question(input: {
  roomId: string;
  minute: number;
  senderUserId: string;
  addressee: string;
}): Promise<{ messageId: string; signalId: string }> {
  const messageId = await message(input);
  const signal = await prisma.chatMessageSignal.create({
    data: {
      messageId,
      roomId: input.roomId,
      state: "tagged",
      probabilities: { question: 0.95 },
      addressedUserIds: [input.addressee],
      taggedAt: at(input.minute),
    },
  });
  return { messageId, signalId: signal.id };
}

/**
 * The Soko Bot's answer to `sourceMessageId`, linked the way a turn links it.
 * A turn links its Thought placeholder at once and marks it `responded` when
 * the answer is complete.
 */
async function botAnswer(input: {
  roomId: string;
  minute: number;
  sourceMessageId: string;
  status?: "pending" | "failed" | "responded";
}): Promise<string> {
  const answer = await message({
    roomId: input.roomId,
    minute: input.minute,
    senderSokoBotId: botId,
  });
  await prisma.chatRoomMention.create({
    data: {
      messageId: input.sourceMessageId,
      sokoBotId: botId,
      responseMessageId: answer,
      status: input.status ?? "responded",
    },
  });
  return answer;
}

async function allPages(take: number): Promise<string[]> {
  const ids: string[] = [];
  let after: { createdAt: Date; id: string } | undefined;
  for (;;) {
    const page = await listChatFeed(alice, organizationId, { after, take });
    ids.push(...page.items.map((item) => item.message.id));
    const last = page.items.at(-1)?.message;
    if (!page.hasMore || !last) return ids;
    after = { createdAt: last.createdAt, id: last.id };
  }
}

describe.runIf(enabled)("chat feed on PostgreSQL", () => {
  const expected: Record<string, string> = {};
  const excluded: Record<string, string> = {};

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
          email: `feed-${id}@sokosumi.test`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Feed test",
        slug: `feed-${organizationId}`,
      },
    });
    await prisma.member.createMany({
      data: [alice, bob, carla].map((userId) => ({ userId, organizationId })),
    });
    await prisma.workspace.create({ data: { id: workspaceId, userId: alice } });
    await prisma.sokoBot.create({
      data: { id: botId, userId: alice, workspaceId },
    });
    const readEarlier = (userIds: string[]) =>
      userIds.map((userId) => ({
        userId,
        lastReadAt: at(-10),
        createdAt: at(-20),
      }));
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
        sokoBotMembers: { create: { sokoBotId: botId } },
        readStates: { create: readEarlier([alice, bob, carla]) },
      },
    });
    await prisma.chatRoom.create({
      data: {
        id: mutedChannelId,
        organizationId,
        name: "random",
        slug: `random-${mutedChannelId.slice(0, 8)}`,
        kind: "channel",
        discoverability: "public",
        createdByUserId: bob,
        userMembers: {
          create: [{ userId: alice, mutedAt: at(-30) }, { userId: bob }],
        },
      },
    });
    await prisma.chatRoom.create({
      data: {
        id: bobDirectId,
        organizationId,
        name: "Alice, Bob",
        kind: "direct",
        directKey: `feed:${bobDirectId}`,
        createdByUserId: alice,
        userMembers: { create: [alice, bob].map((userId) => ({ userId })) },
      },
    });
    await prisma.chatRoom.create({
      data: {
        id: botDirectId,
        organizationId,
        name: "Alice's assistant",
        kind: "direct",
        directKey: `feed:${botDirectId}`,
        createdByUserId: alice,
        userMembers: { create: { userId: alice } },
        sokoBotMembers: { create: { sokoBotId: botId } },
      },
    });

    excluded.chatter = await message({
      roomId: channelId,
      minute: 1,
      senderUserId: bob,
    });
    expected.mention = await message({
      roomId: channelId,
      minute: 2,
      senderUserId: bob,
      mentions: [alice],
    });
    // Same instant as the mention: the cursor must keep both.
    expected.question = (
      await question({
        roomId: channelId,
        minute: 2,
        senderUserId: carla,
        addressee: alice,
      })
    ).messageId;
    const corrected = await question({
      roomId: channelId,
      minute: 3,
      senderUserId: carla,
      addressee: alice,
    });
    await prisma.chatMessageSignalCorrection.create({
      data: {
        signalId: corrected.signalId,
        userId: alice,
        tag: "question",
        applies: false,
      },
    });
    excluded.corrected = corrected.messageId;
    excluded.questionForBob = (
      await question({
        roomId: channelId,
        minute: 4,
        senderUserId: carla,
        addressee: bob,
      })
    ).messageId;
    excluded.own = await message({
      roomId: channelId,
      minute: 5,
      senderUserId: alice,
      mentions: [bob],
    });
    expected.answerToAlice = await botAnswer({
      roomId: channelId,
      minute: 6,
      sourceMessageId: excluded.own,
    });
    const bobAsks = await message({
      roomId: channelId,
      minute: 7,
      senderUserId: bob,
    });
    excluded.answerToBob = await botAnswer({
      roomId: channelId,
      minute: 8,
      sourceMessageId: bobAsks,
    });
    expected.direct = await message({
      roomId: bobDirectId,
      minute: 9,
      senderUserId: bob,
    });
    excluded.ownDirect = await message({
      roomId: bobDirectId,
      minute: 10,
      senderUserId: alice,
    });
    excluded.deletedDirect = await message({
      roomId: bobDirectId,
      minute: 11,
      senderUserId: bob,
      deletedAt: at(12),
    });
    const aliceAsksBot = await message({
      roomId: botDirectId,
      minute: 13,
      senderUserId: alice,
    });
    excluded.botDirectAnswer = await botAnswer({
      roomId: botDirectId,
      minute: 14,
      sourceMessageId: aliceAsksBot,
    });
    const aliceAsksAgain = await message({
      roomId: channelId,
      minute: 16,
      senderUserId: alice,
    });
    excluded.pendingAnswer = await botAnswer({
      roomId: channelId,
      minute: 17,
      sourceMessageId: aliceAsksAgain,
      status: "pending",
    });
    const aliceAsksOnceMore = await message({
      roomId: channelId,
      minute: 18,
      senderUserId: alice,
    });
    excluded.failedAnswer = await botAnswer({
      roomId: channelId,
      minute: 19,
      sourceMessageId: aliceAsksOnceMore,
      status: "failed",
    });
    excluded.muted = await message({
      roomId: mutedChannelId,
      minute: 15,
      senderUserId: bob,
      mentions: [alice],
    });
  });

  afterAll(async () => {
    await prisma.chatRoom.deleteMany({
      where: {
        id: { in: [channelId, mutedChannelId, bobDirectId, botDirectId] },
      },
    });
    await prisma.sokoBot.deleteMany({ where: { id: botId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({
      where: { id: { in: [alice, bob, carla] } },
    });
  });

  it("lists what needs the viewer, newest first, and nothing else", async () => {
    const page = await listChatFeed(alice, organizationId, { take: 50 });
    const ids = page.items.map((item) => item.message.id);
    expect(ids).toEqual([
      expected.direct,
      expected.answerToAlice,
      ...[expected.mention, expected.question].sort().reverse(),
    ]);
    for (const [name, id] of Object.entries(excluded)) {
      expect(ids, name).not.toContain(id);
    }
    expect(page.hasMore).toBe(false);
    expect(page.items[0]).toMatchObject({
      lane: "feed",
      room: { id: bobDirectId, kind: "direct" },
    });
  });

  it("pages by position, each item once, across equal timestamps", async () => {
    const whole = (await listChatFeed(alice, organizationId, { take: 50 }))
      .items;
    expect(await allPages(1)).toEqual(whole.map((item) => item.message.id));
    expect(await allPages(2)).toEqual(whole.map((item) => item.message.id));
  });

  it("counts unread items across pages, until the viewer reads the room", async () => {
    const first = await listChatFeed(alice, organizationId, { take: 1 });
    expect(first.unreadCount).toBe(4);
    await prisma.chatRoomReadState.create({
      data: { roomId: bobDirectId, userId: alice, lastReadAt: new Date() },
    });
    expect(
      (await listChatFeed(alice, organizationId, { take: 1 })).unreadCount,
    ).toBe(3);
  });

  it("keeps an answer unread when the viewer read only its Thought placeholder", async () => {
    // Alice reads the channel after the placeholder was posted (minute 6) but
    // before the answer completed (the mention's updatedAt, now).
    await prisma.chatRoomReadState.update({
      where: { roomId_userId: { roomId: channelId, userId: alice } },
      data: { lastReadAt: at(7) },
    });
    await prisma.chatRoomReadState.upsert({
      where: { roomId_userId: { roomId: bobDirectId, userId: alice } },
      create: { roomId: bobDirectId, userId: alice, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    expect(
      (await listChatFeed(alice, organizationId, { take: 1 })).unreadCount,
    ).toBe(1);
  });
});
