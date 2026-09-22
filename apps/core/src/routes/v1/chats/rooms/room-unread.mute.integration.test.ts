import { randomUUID } from "node:crypto";

import { createPrismaClient } from "@sokosumi/database/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  countChatRoomUnreadThreads,
  getChatRoomThreadAggregates,
  getChatRoomUnreadCounts,
  markAllChatRoomThreadsRead,
  setChatRoomThreadMuted,
} from "./room-unread";

/**
 * Thread mute is a join, and a SQL-string spy cannot see a join. These run the
 * real queries against a real Postgres with the migrations applied.
 *
 * Opt-in: point CHAT_MUTE_INTEGRATION_DATABASE_URL at a disposable local
 * database. Without it the suite skips, exactly as the other Core integration
 * tests do.
 */
const databaseUrl = process.env.CHAT_MUTE_INTEGRATION_DATABASE_URL;
const prisma = databaseUrl ? createPrismaClient(databaseUrl) : null;
const describeWithDb = prisma ? describe : describe.skip;

const ROOM_ID = randomUUID();
const PARENT_ID = randomUUID();
const OTHER_PARENT_ID = randomUUID();
const READER_ID = `user_reader_${randomUUID()}`;
const AUTHOR_ID = `user_author_${randomUUID()}`;
const LURKER_ID = `user_lurker_${randomUUID()}`;

const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);

async function seedUser(id: string) {
  await prisma?.user.create({
    data: {
      id,
      name: id,
      email: `${id}@example.test`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

/** One reply from the author, newer than every look baseline in the room. */
async function reply(parentMessageId: string, content = "later") {
  const created = await prisma?.chatRoomMessage.create({
    data: {
      id: randomUUID(),
      roomId: ROOM_ID,
      parentMessageId,
      senderUserId: AUTHOR_ID,
      content,
      createdAt: new Date(),
    },
  });
  return created!.id;
}

/** A reply older than every baseline: it makes the parent a Thread, silently. */
async function settledReply(parentMessageId: string) {
  await prisma?.chatRoomMessage.create({
    data: {
      id: randomUUID(),
      roomId: ROOM_ID,
      parentMessageId,
      senderUserId: AUTHOR_ID,
      content: "settled",
      createdAt: past(450),
    },
  });
}

describeWithDb("thread mute against Postgres", () => {
  beforeAll(async () => {
    await seedUser(READER_ID);
    await seedUser(AUTHOR_ID);
    await seedUser(LURKER_ID);
    await prisma?.chatRoom.create({
      data: {
        id: ROOM_ID,
        name: "mute-room",
        slug: `mute-room-${randomUUID()}`,
        kind: "channel",
        // Org-less matched channel: a room with no organization to seed.
        discoverability: "matched",
        createdByUserId: AUTHOR_ID,
      },
    });
    await prisma?.chatRoomUserMember.createMany({
      data: [
        { roomId: ROOM_ID, userId: READER_ID, createdAt: past(600) },
        { roomId: ROOM_ID, userId: AUTHOR_ID, createdAt: past(600) },
        { roomId: ROOM_ID, userId: LURKER_ID, createdAt: past(600) },
      ],
    });
    await prisma?.chatRoomReadState.createMany({
      data: [
        { roomId: ROOM_ID, userId: READER_ID, lastReadAt: past(500) },
        { roomId: ROOM_ID, userId: LURKER_ID, lastReadAt: past(500) },
      ],
    });
    // The reader authored both parents, so they Participate in both threads.
    for (const id of [PARENT_ID, OTHER_PARENT_ID]) {
      await prisma?.chatRoomMessage.create({
        data: {
          id,
          roomId: ROOM_ID,
          senderUserId: READER_ID,
          content: "root",
          createdAt: past(400),
        },
      });
    }
  });

  afterAll(async () => {
    await prisma?.chatRoom.deleteMany({ where: { id: ROOM_ID } });
    await prisma?.user.deleteMany({
      where: { id: { in: [READER_ID, AUTHOR_ID, LURKER_ID] } },
    });
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    await prisma?.chatRoomUserMention.deleteMany({
      where: { message: { roomId: ROOM_ID } },
    });
    await prisma?.chatRoomMessage.deleteMany({
      where: { roomId: ROOM_ID, parentMessageId: { not: null } },
    });
    await prisma?.chatRoomThreadReadState.deleteMany({
      where: { parentMessageId: { in: [PARENT_ID, OTHER_PARENT_ID] } },
    });
    // A parent is a Thread only once it has a reply, and mute refuses a
    // parent that is not one yet.
    await settledReply(PARENT_ID);
    await settledReply(OTHER_PARENT_ID);
  });

  async function roomUnread() {
    const counts = await getChatRoomUnreadCounts([ROOM_ID], READER_ID, prisma!);
    return counts.get(ROOM_ID)?.total ?? 0;
  }

  async function unreadRepliesOn(parentMessageId: string) {
    const [aggregate] = await getChatRoomThreadAggregates(
      ROOM_ID,
      READER_ID,
      prisma!,
      { parentMessageId },
    );
    return aggregate?.unreadReplyCount ?? 0;
  }

  it("counts a reply for a Participant who has not muted", async () => {
    await reply(PARENT_ID);

    expect(await roomUnread()).toBe(1);
    expect(await unreadRepliesOn(PARENT_ID)).toBe(1);
    expect(await countChatRoomUnreadThreads(ROOM_ID, READER_ID, prisma!)).toBe(
      1,
    );
  });

  it("stops counting replies once the thread is muted", async () => {
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, true, prisma!);
    await reply(PARENT_ID);

    expect(await roomUnread()).toBe(0);
    expect(await unreadRepliesOn(PARENT_ID)).toBe(0);
    expect(await countChatRoomUnreadThreads(ROOM_ID, READER_ID, prisma!)).toBe(
      0,
    );
  });

  it("clears the replies already waiting when it mutes", async () => {
    await reply(PARENT_ID);
    expect(await roomUnread()).toBe(1);

    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, true, prisma!);

    expect(await roomUnread()).toBe(0);
  });

  it("keeps an unmuted sibling thread counting", async () => {
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, true, prisma!);
    await reply(PARENT_ID);
    await reply(OTHER_PARENT_ID);

    expect(await roomUnread()).toBe(1);
    expect(await unreadRepliesOn(OTHER_PARENT_ID)).toBe(1);
  });

  it("pages the reader again after unmute, without replaying the silence", async () => {
    // An explicit mute time: a reply in the same millisecond would tie the
    // baseline and read as still unread.
    await setChatRoomThreadMuted(
      ROOM_ID,
      READER_ID,
      PARENT_ID,
      true,
      prisma!,
      past(5),
    );
    await reply(PARENT_ID, "while muted");
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, false, prisma!);

    expect(await roomUnread()).toBe(0);

    await reply(PARENT_ID, "after unmute");

    expect(await roomUnread()).toBe(1);
  });

  it("lets a reply that names the reader through a muted thread", async () => {
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, true, prisma!);
    const replyId = await reply(PARENT_ID, "@reader look");
    await prisma?.chatRoomUserMention.create({
      data: { messageId: replyId, userId: READER_ID },
    });

    expect(await roomUnread()).toBe(1);
    expect(await unreadRepliesOn(PARENT_ID)).toBe(1);
  });

  it("SOK-1087 story 9: Mark all skips muted threads with unread mentions", async () => {
    const mutedAt = past(5);
    await setChatRoomThreadMuted(
      ROOM_ID,
      READER_ID,
      PARENT_ID,
      true,
      prisma!,
      mutedAt,
    );
    const namedId = await reply(PARENT_ID, "@reader look");
    await prisma?.chatRoomUserMention.create({
      data: { messageId: namedId, userId: READER_ID },
    });
    await reply(OTHER_PARENT_ID);
    expect(await roomUnread()).toBe(2);

    const looked = await markAllChatRoomThreadsRead(
      ROOM_ID,
      READER_ID,
      prisma!,
    );

    expect(looked).toBe(1);
    const muted = await prisma?.chatRoomThreadReadState.findUnique({
      where: {
        userId_parentMessageId: {
          userId: READER_ID,
          parentMessageId: PARENT_ID,
        },
      },
    });
    expect(muted?.mutedAt).toEqual(mutedAt);
    expect(muted?.lastReadAt).toEqual(mutedAt);
    expect(await unreadRepliesOn(PARENT_ID)).toBe(1);
    expect(await unreadRepliesOn(OTHER_PARENT_ID)).toBe(0);
    expect(await countChatRoomUnreadThreads(ROOM_ID, READER_ID, prisma!)).toBe(
      1,
    );
    expect(await roomUnread()).toBe(1);
  });

  it("refuses a parent that is not a thread yet", async () => {
    await prisma?.chatRoomMessage.deleteMany({
      where: { parentMessageId: PARENT_ID },
    });

    const state = await setChatRoomThreadMuted(
      ROOM_ID,
      READER_ID,
      PARENT_ID,
      true,
      prisma!,
    );

    expect(state).toBeNull();
    expect(
      await prisma?.chatRoomThreadReadState.count({
        where: { userId: READER_ID, parentMessageId: PARENT_ID },
      }),
    ).toBe(0);
  });

  it("leaves real unread alone when unmuting a thread nobody muted", async () => {
    await reply(PARENT_ID);
    expect(await roomUnread()).toBe(1);

    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, false, prisma!);

    expect(await roomUnread()).toBe(1);
  });

  it("does not change Participant, so unmute restores the untouched count", async () => {
    await setChatRoomThreadMuted(
      ROOM_ID,
      READER_ID,
      PARENT_ID,
      true,
      prisma!,
      past(5),
    );
    const replyId = await reply(PARENT_ID, "@reader still here");
    await prisma?.chatRoomUserMention.create({
      data: { messageId: replyId, userId: READER_ID },
    });
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, false, prisma!);

    // The mention row and the parent authorship survived the mute, so a reply
    // that names nobody pages the reader again on Participant alone. The
    // reply that named them is still unread too: it was never silenced.
    await reply(PARENT_ID, "after unmute");

    expect(await unreadRepliesOn(PARENT_ID)).toBe(2);
    expect(
      await prisma?.chatRoomUserMention.count({
        where: { userId: READER_ID, messageId: replyId },
      }),
    ).toBe(1);
  });

  it("is a no-op on the counts of a lurker who muted", async () => {
    async function lurkerUnread() {
      const counts = await getChatRoomUnreadCounts(
        [ROOM_ID],
        LURKER_ID,
        prisma!,
      );
      return counts.get(ROOM_ID)?.total ?? 0;
    }

    // The lurker still has the two top-level parents waiting. Only the thread
    // side is under test here.
    const before = await lurkerUnread();

    await setChatRoomThreadMuted(ROOM_ID, LURKER_ID, PARENT_ID, true, prisma!);
    await reply(PARENT_ID);

    expect(await lurkerUnread()).toBe(before);
    expect(await countChatRoomUnreadThreads(ROOM_ID, LURKER_ID, prisma!)).toBe(
      0,
    );
  });

  it("keeps a mention that broke through when the reader unmutes", async () => {
    await setChatRoomThreadMuted(
      ROOM_ID,
      READER_ID,
      PARENT_ID,
      true,
      prisma!,
      past(5),
    );
    await reply(PARENT_ID, "chatter");
    const namedId = await reply(PARENT_ID, "@reader look");
    await prisma?.chatRoomUserMention.create({
      data: { messageId: namedId, userId: READER_ID },
    });
    expect(await unreadRepliesOn(PARENT_ID)).toBe(1);

    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, false, prisma!);

    // The reply that named the reader was never silenced, so unmute leaves
    // the look where mute put it rather than stepping over it. The chatter
    // around it comes back with it: a high-water mark cannot split them.
    expect(await unreadRepliesOn(PARENT_ID)).toBe(2);
    expect(await roomUnread()).toBe(2);
  });

  it("keeps a broken-through mention when the reader mutes again", async () => {
    await setChatRoomThreadMuted(
      ROOM_ID,
      READER_ID,
      PARENT_ID,
      true,
      prisma!,
      past(5),
    );
    const namedId = await reply(PARENT_ID, "@reader look");
    await prisma?.chatRoomUserMention.create({
      data: { messageId: namedId, userId: READER_ID },
    });
    expect(await unreadRepliesOn(PARENT_ID)).toBe(1);

    // A stale second tab can send this: the thread is already muted.
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, true, prisma!);

    expect(await unreadRepliesOn(PARENT_ID)).toBe(1);
  });

  it("reports the mute state on the thread", async () => {
    await reply(PARENT_ID);
    await setChatRoomThreadMuted(ROOM_ID, READER_ID, PARENT_ID, true, prisma!);

    const [aggregate] = await getChatRoomThreadAggregates(
      ROOM_ID,
      READER_ID,
      prisma!,
      { parentMessageId: PARENT_ID },
    );

    expect(aggregate?.mutedAt).toBeInstanceOf(Date);
  });
});
