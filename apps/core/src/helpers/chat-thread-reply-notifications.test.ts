import { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
} from "@sokosumi/utils";
import { describe, expect, it, vi } from "vitest";

import {
  findThreadReplyRowsPassedByRoomRead,
  findUnreadThreadReplyRows,
  markLookedThreadReplyRowsRead,
} from "@/helpers/chat-thread-reply-notifications";

const ROOM_ID = "room-a";
const USER_ID = "user_1";
const OTHER_ID = "user_2";
const REPLY_AT = new Date("2026-09-29T08:00:00.000Z");

interface Message {
  id: string;
  roomId: string;
  parentMessageId: string | null;
  senderUserId: string;
  createdAt: Date;
  deletedAt: Date | null;
}

function message(
  id: string,
  parentMessageId: string | null,
  senderUserId: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    roomId: ROOM_ID,
    parentMessageId,
    senderUserId,
    createdAt: REPLY_AT,
    deletedAt: null,
    ...extra,
  };
}

/** The `where` shapes the helper sends, applied to one message. */
function matches(row: Message, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key as keyof Message];
    if (condition === null) {
      return value === null;
    }
    if (typeof condition === "string") {
      return value === condition;
    }
    const { in: within, not } = condition as { in?: unknown[]; not?: null };
    if (within) {
      return within.includes(value);
    }
    return not === null ? value !== null : true;
  });
}

/**
 * A small store the fakes answer from, so every read is filtered by what it
 * asked for: the wrong ids, the wrong user or a missing filter gets the wrong
 * answer.
 *
 * The reader wrote `parent-looked`; `parent-unlooked` named them on a reply;
 * `parent-named` named them on the parent; `parent-lurker` named only someone
 * else and holds only a deleted reply of the reader's; `parent-elsewhere` is
 * theirs but its reply is in another room.
 */
function fakeTx(
  looks: Array<{ userId: string; parentMessageId: string; lastReadAt: Date }>,
  options: {
    repliedInLurker?: boolean;
    deletedParent?: boolean;
    responses?: Array<{
      responseMessageId: string;
      status: string;
      updatedAt: Date;
    }>;
    readStates?: Array<{ userId: string; roomId: string; lastReadAt: Date }>;
  } = {},
) {
  const messages: Message[] = [
    message("parent-looked", null, USER_ID, {
      deletedAt: options.deletedParent ? REPLY_AT : null,
    }),
    message("parent-unlooked", null, OTHER_ID),
    message("parent-named", null, OTHER_ID),
    message("parent-lurker", null, OTHER_ID),
    message("parent-elsewhere", null, USER_ID, { roomId: "room-b" }),
    message("msg-top", null, OTHER_ID),
    message("msg-looked", "parent-looked", OTHER_ID),
    message("msg-unlooked", "parent-unlooked", OTHER_ID),
    message("msg-named", "parent-named", OTHER_ID),
    message("msg-lurker", "parent-lurker", OTHER_ID),
    message("msg-own-deleted", "parent-lurker", USER_ID, {
      deletedAt: REPLY_AT,
    }),
    message("msg-elsewhere", "parent-elsewhere", OTHER_ID, {
      roomId: "room-b",
    }),
    ...(options.repliedInLurker
      ? [message("msg-own", "parent-lurker", USER_ID)]
      : []),
  ];
  const mentions = [
    { userId: USER_ID, messageId: "msg-unlooked" },
    { userId: USER_ID, messageId: "parent-named" },
    { userId: OTHER_ID, messageId: "msg-lurker" },
  ];

  const notificationFindMany = vi.fn().mockResolvedValue(
    [
      "msg-top",
      "msg-looked",
      "msg-unlooked",
      "msg-named",
      "msg-lurker",
      "msg-elsewhere",
    ].map((eventId) => ({
      id: eventId.replace("msg-", "n-"),
      referenceId: ROOM_ID,
      eventId,
    })),
  );
  const messageFindMany = vi
    .fn()
    .mockImplementation(async ({ where }) =>
      messages.filter((row) => matches(row, where)),
    );
  const mentionFindMany = vi.fn().mockImplementation(async ({ where }) =>
    mentions
      .filter((mention) => mention.userId === where.userId)
      .map((mention) => messages.find((row) => row.id === mention.messageId))
      .filter(
        (row): row is Message =>
          row !== undefined &&
          row.deletedAt === where.message.deletedAt &&
          where.message.OR.some((branch: Record<string, unknown>) =>
            matches(row, branch),
          ),
      )
      .map((row) => ({
        message: { id: row.id, parentMessageId: row.parentMessageId },
      })),
  );
  const threadReadFindMany = vi
    .fn()
    .mockImplementation(async ({ where }) =>
      looks.filter(
        (look) =>
          look.userId === where.userId &&
          where.parentMessageId.in.includes(look.parentMessageId),
      ),
    );
  const responseFindMany = vi
    .fn()
    .mockImplementation(async ({ where }) =>
      (options.responses ?? []).filter(
        (response) =>
          response.status === where.status &&
          where.responseMessageId.in.includes(response.responseMessageId),
      ),
    );
  const readStateFindMany = vi
    .fn()
    .mockImplementation(async ({ where }) =>
      (options.readStates ?? []).filter(
        (state) =>
          state.userId === where.userId &&
          where.roomId.in.includes(state.roomId),
      ),
    );
  const updateManyAndReturn = vi.fn().mockImplementation(async ({ where }) =>
    where.id.in.map((id: string) => ({
      id,
      emailId: null,
      emailScheduledAt: null,
    })),
  );

  return {
    tx: {
      notification: { findMany: notificationFindMany, updateManyAndReturn },
      chatRoomMessage: { findMany: messageFindMany },
      chatRoomUserMention: { findMany: mentionFindMany },
      chatRoomMention: { findMany: responseFindMany },
      chatRoomThreadReadState: { findMany: threadReadFindMany },
      chatRoomReadState: { findMany: readStateFindMany },
    } as never,
    notificationFindMany,
    messageFindMany,
    updateManyAndReturn,
  };
}

describe("findUnreadThreadReplyRows", () => {
  it("returns the unread rows about replies in Threads the reader Participates in", async () => {
    const { tx, notificationFindMany, messageFindMany } = fakeTx([]);

    const rows = await findUnreadThreadReplyRows([ROOM_ID], USER_ID, tx);

    // Wrote the parent, named on a reply, named on the parent. The top-level
    // row, the lurker Thread and the other room's reply stay with Room
    // last-read.
    expect(rows).toEqual([
      {
        id: "n-looked",
        roomId: ROOM_ID,
        parentMessageId: "parent-looked",
        replyAttentionAt: REPLY_AT,
      },
      {
        id: "n-unlooked",
        roomId: ROOM_ID,
        parentMessageId: "parent-unlooked",
        replyAttentionAt: REPLY_AT,
      },
      {
        id: "n-named",
        roomId: ROOM_ID,
        parentMessageId: "parent-named",
        replyAttentionAt: REPLY_AT,
      },
    ]);
    // Only the per-message keys: a room-message row counts many messages
    // onto one row about the room.
    expect(notificationFindMany).toHaveBeenCalledWith({
      where: {
        userId: USER_ID,
        kind: NotificationKind.CHAT,
        referenceId: { in: [ROOM_ID] },
        messageKey: {
          in: [CHAT_MENTION_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_MESSAGE_KEY],
        },
        isRead: false,
      },
      select: { id: true, referenceId: true, eventId: true },
    });
    // A deleted reply is nothing to read.
    expect(messageFindMany.mock.calls[0]?.[0]?.where).toMatchObject({
      deletedAt: null,
    });
  });

  it("counts a Thread the reader replied in as Participated", async () => {
    const { tx } = fakeTx([], { repliedInLurker: true });

    const rows = await findUnreadThreadReplyRows([ROOM_ID], USER_ID, tx);

    expect(rows.map((row) => row.id)).toContain("n-lurker");
  });

  it("drops the rows of a Thread whose parent is deleted", async () => {
    const { tx } = fakeTx([], { deletedParent: true });

    const rows = await findUnreadThreadReplyRows([ROOM_ID], USER_ID, tx);

    expect(rows.map((row) => row.id)).toEqual(["n-unlooked", "n-named"]);
  });

  it("reads nothing for no rooms", async () => {
    const { tx, notificationFindMany } = fakeTx([]);

    expect(await findUnreadThreadReplyRows([], USER_ID, tx)).toEqual([]);
    expect(notificationFindMany).not.toHaveBeenCalled();
  });
});

describe("findThreadReplyRowsPassedByRoomRead", () => {
  it("returns the rows whose reply the reader's Room last-read is at or after", async () => {
    const { tx } = fakeTx([], {
      readStates: [
        { userId: USER_ID, roomId: ROOM_ID, lastReadAt: REPLY_AT },
        { userId: OTHER_ID, roomId: ROOM_ID, lastReadAt: REPLY_AT },
      ],
    });

    const rows = await findThreadReplyRowsPassedByRoomRead(
      [ROOM_ID],
      USER_ID,
      tx,
    );

    expect(rows.map((row) => row.id)).toEqual([
      "n-looked",
      "n-unlooked",
      "n-named",
    ]);
  });

  it("returns nothing while the reader opened the room before the reply", async () => {
    const { tx } = fakeTx([], {
      readStates: [
        {
          userId: USER_ID,
          roomId: ROOM_ID,
          lastReadAt: new Date(REPLY_AT.getTime() - 1),
        },
      ],
    });

    expect(
      await findThreadReplyRowsPassedByRoomRead([ROOM_ID], USER_ID, tx),
    ).toEqual([]);
  });

  /**
   * A coworker's Thought placeholder is created before its answer. The answer
   * is readable when its mention reaches responded, as Thread unread reads it.
   */
  it("dates a coworker answer by when its mention was responded", async () => {
    const answeredAt = new Date(REPLY_AT.getTime() + 60_000);
    const { tx } = fakeTx([], {
      readStates: [{ userId: USER_ID, roomId: ROOM_ID, lastReadAt: REPLY_AT }],
      responses: [
        {
          responseMessageId: "msg-looked",
          status: "responded",
          updatedAt: answeredAt,
        },
        // Still streaming: its time says nothing yet.
        {
          responseMessageId: "msg-unlooked",
          status: "pending",
          updatedAt: answeredAt,
        },
      ],
    });

    const rows = await findThreadReplyRowsPassedByRoomRead(
      [ROOM_ID],
      USER_ID,
      tx,
    );

    expect(rows.map((row) => row.id)).toEqual(["n-unlooked", "n-named"]);
  });

  it("ignores someone else's Room last-read", async () => {
    const { tx } = fakeTx([], {
      readStates: [{ userId: OTHER_ID, roomId: ROOM_ID, lastReadAt: REPLY_AT }],
    });

    expect(
      await findThreadReplyRowsPassedByRoomRead([ROOM_ID], USER_ID, tx),
    ).toEqual([]);
  });
});

describe("markLookedThreadReplyRowsRead", () => {
  it("clears only the rows whose Thread the reader Looked at or after the reply", async () => {
    const later = new Date("2026-09-29T09:00:00.000Z");
    const { tx, updateManyAndReturn } = fakeTx([
      {
        userId: USER_ID,
        parentMessageId: "parent-looked",
        lastReadAt: REPLY_AT,
      },
      {
        userId: USER_ID,
        parentMessageId: "parent-unlooked",
        lastReadAt: new Date(REPLY_AT.getTime() - 1),
      },
      // Someone else's Look reads nothing for the reader.
      { userId: OTHER_ID, parentMessageId: "parent-named", lastReadAt: later },
    ]);

    const cleared = await markLookedThreadReplyRowsRead(
      ROOM_ID,
      USER_ID,
      tx,
      later,
    );

    expect(cleared.map((row) => row.id)).toEqual(["n-looked"]);
    expect(updateManyAndReturn).toHaveBeenCalledWith({
      where: { id: { in: ["n-looked"] }, userId: USER_ID, isRead: false },
      data: { isRead: true, readAt: later },
      select: { id: true, emailId: true, emailScheduledAt: true },
    });
  });

  it("keeps a coworker answer that was responded after the Look", async () => {
    const { tx, updateManyAndReturn } = fakeTx(
      [
        {
          userId: USER_ID,
          parentMessageId: "parent-looked",
          lastReadAt: REPLY_AT,
        },
      ],
      {
        responses: [
          {
            responseMessageId: "msg-looked",
            status: "responded",
            updatedAt: new Date(REPLY_AT.getTime() + 1),
          },
        ],
      },
    );

    expect(await markLookedThreadReplyRowsRead(ROOM_ID, USER_ID, tx)).toEqual(
      [],
    );
    expect(updateManyAndReturn).not.toHaveBeenCalled();
  });

  it("writes nothing when no Thread was Looked", async () => {
    const { tx, updateManyAndReturn } = fakeTx([]);

    expect(await markLookedThreadReplyRowsRead(ROOM_ID, USER_ID, tx)).toEqual(
      [],
    );
    expect(updateManyAndReturn).not.toHaveBeenCalled();
  });
});
