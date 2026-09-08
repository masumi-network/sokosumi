import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  resolveDeliveryMock,
  publishNotificationRowMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  messageFindUniqueMock,
  notificationFindFirstMock,
  notificationFindManyMock,
  notificationUpdateManyMock,
  notificationFindUniqueMock,
  captureExceptionMock,
  transactionMock,
  queryRawMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  resolveDeliveryMock: vi.fn(),
  publishNotificationRowMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationFindManyMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  notificationFindUniqueMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  transactionMock: vi.fn(),
  queryRawMock: vi.fn(),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  resolveDelivery: (...args: unknown[]) => resolveDeliveryMock(...args),
  publishNotificationRow: (...args: unknown[]) =>
    publishNotificationRowMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomMessage: {
      findUnique: messageFindUniqueMock,
    },
    notification: {
      findFirst: notificationFindFirstMock,
      findMany: notificationFindManyMock,
      updateMany: notificationUpdateManyMock,
      findUnique: notificationFindUniqueMock,
    },
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import prisma from "@/lib/db/prisma";

import {
  fanOutChatNotifications,
  rewriteChatNotificationPreviews,
} from "./chat-notification-fanout";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const AUTHOR_ID = "user_author";
const ALICE_ID = "user_alice";
const BOB_ID = "user_bob";

function params(
  overrides: Partial<Parameters<typeof fanOutChatNotifications>[0]> = {},
) {
  return {
    roomId: ROOM_ID,
    roomName: "general",
    organizationId: "org_1" as string | null,
    messageId: MESSAGE_ID,
    content: "ship it",
    authorUserId: AUTHOR_ID as string | null,
    authorName: "Patrick",
    recipientUserIds: [ALICE_ID],
    messageKey: "Notifications.Chat.roomMessage",
    notificationType: "chat-room-message",
    ...overrides,
  };
}

/** The message row the fan-out reads, saying what the caller passed. */
function messageSays(content: string) {
  messageFindUniqueMock.mockResolvedValue({ deletedAt: null, content });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryRawMock.mockResolvedValue([]);
  transactionMock.mockImplementation(async (callback) =>
    callback({
      $queryRaw: queryRawMock,
      chatRoomMessage: { findUnique: messageFindUniqueMock },
      notification: {
        findMany: notificationFindManyMock,
        updateMany: notificationUpdateManyMock,
        findUnique: notificationFindUniqueMock,
      },
    }),
  );
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
  notificationFindFirstMock.mockResolvedValue(null);
  notificationFindManyMock.mockResolvedValue([]);
  messageSays("ship it");
  // One row matched, which is the write landing on the row it named.
  notificationUpdateManyMock.mockResolvedValue({ count: 1 });
  notificationFindUniqueMock.mockResolvedValue({ id: "notification_1" });
  resolveDeliveryMock.mockResolvedValue({ inApp: true, osBanner: false });
});

/** A row the reader already has for this room, unread and shown in the app. */
function unreadRow(
  messageParams: Record<string, unknown>,
  metadata: Record<string, unknown> | null = null,
) {
  return {
    id: "notification_1",
    userId: ALICE_ID,
    kind: NotificationKind.CHAT,
    referenceId: ROOM_ID,
    messageKey: "Notifications.Chat.roomMessage",
    messageParams: JSON.stringify(messageParams),
    metadata: metadata === null ? null : JSON.stringify(metadata),
    isRead: false,
    inApp: true,
  };
}

describe("fanOutChatNotifications", () => {
  it("writes one notification per recipient under the given message key", async () => {
    await fanOutChatNotifications(
      params({ recipientUserIds: [ALICE_ID, BOB_ID] }),
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: ALICE_ID,
      kind: NotificationKind.CHAT,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: {
        authorName: "Patrick",
        roomName: "general",
        messagePreview: "ship it",
      },
      metadata: { messageId: MESSAGE_ID, workspaceId: "workspace_1" },
    });
  });

  it("drops the author and repeats, so one reader gets one notification", async () => {
    await fanOutChatNotifications(
      params({
        recipientUserIds: [AUTHOR_ID, ALICE_ID, ALICE_ID],
      }),
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ALICE_ID }),
    );
  });

  /**
   * A coworker author has no user id, so nobody in the room is the author and
   * the whole roster stays.
   */
  it("keeps every recipient when the author is not a user", async () => {
    await fanOutChatNotifications(
      params({
        authorUserId: null,
        recipientUserIds: [AUTHOR_ID, ALICE_ID],
      }),
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(2);
  });

  it("does not notify a reader who muted the room", async () => {
    membershipFindManyMock.mockResolvedValue([{ userId: BOB_ID }]);

    await fanOutChatNotifications(
      params({ recipientUserIds: [ALICE_ID, BOB_ID] }),
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ALICE_ID }),
    );
  });

  /**
   * The fan-out runs after the response, so a reader can delete the message
   * before it lands. The delete wipes the rows that exist by then; writing
   * the preview now would put the text back with nothing left to take it off.
   */
  it("writes no preview for a message deleted while it ran", async () => {
    messageFindUniqueMock.mockResolvedValue({ deletedAt: new Date() });

    await fanOutChatNotifications(params({ content: "meet at five" }));

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.not.objectContaining({
          messagePreview: expect.anything(),
        }),
      }),
    );
  });

  it("writes no preview for a message that is gone entirely", async () => {
    messageFindUniqueMock.mockResolvedValue(null);

    await fanOutChatNotifications(params({ content: "meet at five" }));

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.not.objectContaining({
          messagePreview: expect.anything(),
        }),
      }),
    );
  });

  /**
   * The preview is what a reader is shown on a lock screen, so the line is
   * written out here rather than built by calling the rule the code calls.
   */
  it("gives every recipient the same preview of the message", async () => {
    messageSays(
      "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:Ada **can you** look at the login flow",
    );

    await fanOutChatNotifications(
      params({
        content:
          "@019fc7e4-e4bd-7005-900c-66e44d33f5e4:Ada **can you** look at the login flow",
        recipientUserIds: [ALICE_ID, BOB_ID],
      }),
    );

    for (const userId of [ALICE_ID, BOB_ID]) {
      expect(createNotificationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          messageParams: expect.objectContaining({
            messagePreview: "@Ada can you look at the login flow",
          }),
        }),
      );
    }
  });

  it("names the file when the message is only a file", async () => {
    messageSays("[report.pdf](https://example.test/report.pdf)");

    await fanOutChatNotifications(
      params({ content: "[report.pdf](https://example.test/report.pdf)" }),
    );

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageParams: expect.objectContaining({
          messagePreview: "report.pdf",
        }),
      }),
    );
  });

  /**
   * Omitted rather than empty, so the reader is shown the line that names the
   * author and the room instead of a banner with nothing under it.
   */
  it("writes no preview when the message cleans to nothing", async () => {
    await fanOutChatNotifications(params({ content: "****" }));

    const input = createNotificationMock.mock.calls[0]?.[0] as {
      messageParams: Record<string, unknown>;
    };
    expect(input.messageParams).not.toHaveProperty("messagePreview");
  });

  it("stops before the workspace lookup when nobody is left to notify", async () => {
    membershipFindManyMock.mockResolvedValue([{ userId: ALICE_ID }]);

    await fanOutChatNotifications(params());

    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(messageFindUniqueMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("does not read a workspace for a room outside an organization", async () => {
    await fanOutChatNotifications(params({ organizationId: null }));

    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { messageId: MESSAGE_ID, workspaceId: null },
      }),
    );
  });

  /**
   * One reader's failed write must not cost the others theirs, so the loop
   * reports and continues.
   */
  it("reports a failed write and still notifies the rest", async () => {
    const failure = new Error("write failed");
    createNotificationMock
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ created: true });

    await fanOutChatNotifications(
      params({ recipientUserIds: [ALICE_ID, BOB_ID] }),
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(captureExceptionMock).toHaveBeenCalledWith(failure, {
      extra: {
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        userId: ALICE_ID,
        notificationType: "chat-room-message",
      },
    });
  });

  /**
   * The delete takes the text off the rows that exist when it runs. Rows
   * written after that are this loop's, and nothing else comes back for them,
   * so the loop takes its own text back.
   */
  it("takes the text back when the message is deleted while it wrote", async () => {
    messageFindUniqueMock
      .mockResolvedValueOnce({ deletedAt: null, content: "door code 4417" })
      .mockResolvedValue({ deletedAt: new Date(), content: "" });
    notificationFindManyMock.mockResolvedValue([
      storedRow({
        authorName: "Patrick",
        roomName: "general",
        messagePreview: "door code 4417",
      }),
    ]);

    await fanOutChatNotifications(
      params({
        content: "door code 4417",
        recipientUserIds: [ALICE_ID, BOB_ID],
      }),
    );

    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(notificationFindManyMock).toHaveBeenCalledWith({
      where: {
        kind: NotificationKind.CHAT,
        referenceId: ROOM_ID,
        metadata: { contains: `"messageId":"${MESSAGE_ID}"` },
      },
      select: { id: true, messageParams: true, metadata: true },
      orderBy: { id: "asc" },
    });
    expect(paramsWrittenTo(0)).toEqual({
      authorName: "Patrick",
      roomName: "general",
    });
  });

  it("writes what the message now says when it is edited while it wrote", async () => {
    messageFindUniqueMock
      .mockResolvedValueOnce({ deletedAt: null, content: "meet at five" })
      .mockResolvedValue({ deletedAt: null, content: "meet at **six**" });
    notificationFindManyMock.mockResolvedValue([
      storedRow({
        authorName: "Patrick",
        roomName: "general",
        messagePreview: "meet at five",
      }),
    ]);

    await fanOutChatNotifications(params({ content: "meet at five" }));

    expect(paramsWrittenTo(0)).toEqual({
      authorName: "Patrick",
      roomName: "general",
      messagePreview: "meet at six",
    });
  });

  /**
   * The fan-out runs under `waitUntil`, so the instance may be suspended once
   * its promise settles. A rewrite left running is a rewrite dropped, and its
   * own catch would keep that silent.
   */
  it("does not finish before the text it takes back is gone", async () => {
    const order: string[] = [];
    messageFindUniqueMock
      .mockResolvedValueOnce({ deletedAt: null, content: "door code 4417" })
      .mockResolvedValue({ deletedAt: new Date(), content: "" });
    notificationFindManyMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("rewrite");
      return [];
    });

    await fanOutChatNotifications(params({ content: "door code 4417" }));
    order.push("done");

    expect(order).toEqual(["rewrite", "done"]);
  });

  /**
   * Both reads are of this message, by its own id. Reading the room instead
   * finds no row, and the fan-out then writes every preview it should have
   * held back and takes none of them away again.
   */
  it("reads the message it is about, by the id it was given", async () => {
    await fanOutChatNotifications(params());

    expect(messageFindUniqueMock).toHaveBeenNthCalledWith(1, {
      where: { id: MESSAGE_ID },
      select: { deletedAt: true },
    });
    expect(messageFindUniqueMock).toHaveBeenNthCalledWith(2, {
      where: { id: MESSAGE_ID },
      select: { content: true, deletedAt: true },
    });
  });

  it("looks no further when the message still says what it wrote", async () => {
    await fanOutChatNotifications(params());

    expect(messageFindUniqueMock).toHaveBeenCalledTimes(2);
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });

  /** Nothing was written, so there is nothing to take back or bring forward. */
  it("does not look again when it wrote no preview at all", async () => {
    messageSays("****");

    await fanOutChatNotifications(params({ content: "****" }));

    expect(messageFindUniqueMock).toHaveBeenCalledTimes(1);
    expect(notificationFindManyMock).not.toHaveBeenCalled();
  });
});

describe("fanOutChatNotifications, counting per room", () => {
  it("writes the first row when the reader has none for the room", async () => {
    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      userId: ALICE_ID,
      referenceId: ROOM_ID,
      messageParams: {
        authorName: "Patrick",
        roomName: "general",
        messagePreview: "ship it",
      },
    });
  });

  /**
   * The whole point of the flag. Twenty messages in a busy room are twenty
   * rows without it, and the notification center is that room and nothing
   * else.
   */
  it("counts a later message onto the row the reader has not read", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general" }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);

    const write = notificationUpdateManyMock.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { messageParams: string };
    };
    // The row, the count it was read with, and still unread. A blind write
    // would overwrite a count another message put there in between.
    expect(write.where).toEqual({
      id: "notification_1",
      messageParams: JSON.stringify({
        authorName: "Ada",
        roomName: "general",
      }),
      isRead: false,
    });
    expect(JSON.parse(write.data.messageParams)).toEqual({
      authorName: "Patrick",
      roomName: "general",
      messagePreview: "ship it",
      count: 2,
    });
  });

  it("carries the count on from the row it lands on", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general", count: 22 }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    const write = notificationUpdateManyMock.mock.calls[0]?.[0] as {
      data: { messageParams: string };
    };
    expect(JSON.parse(write.data.messageParams).count).toBe(23);
  });

  /**
   * Read is where a group ends, which is what makes the count mean "since you
   * last looked". The row is found by `isRead: false`, so a read one is never
   * offered here.
   */
  /**
   * Unread, and shown in the app. A row written while the reader had the
   * category silenced is not one they are reading, and counting onto it would
   * hand them everything they silenced the day they turn it back on.
   */
  it("looks only at the reader's unread, unsilenced row for this room", async () => {
    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: {
        userId: ALICE_ID,
        kind: NotificationKind.CHAT,
        referenceId: ROOM_ID,
        messageKey: "Notifications.Chat.roomMessage",
        isRead: false,
        inApp: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("leaves the row's own delivery answer where it is", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general" }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    const write = notificationUpdateManyMock.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(write.data).not.toHaveProperty("inApp");
  });

  /**
   * An open tab holds the row by id and replaces it on a realtime event, so a
   * count nobody published is a count nobody sees until the next reload.
   */
  it("publishes the row it counted onto", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general" }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(publishNotificationRowMock).toHaveBeenCalledTimes(1);
    expect(publishNotificationRowMock.mock.calls[0]?.[1]).toEqual({
      inApp: true,
      osBanner: false,
    });
  });

  it("keeps a banner-only message out of an existing in-app row", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general" }),
    );
    resolveDeliveryMock.mockResolvedValue({ inApp: false, osBanner: true });

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationFindFirstMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(publishNotificationRowMock).not.toHaveBeenCalled();
  });

  /**
   * Two messages in one room can read the same count and both write count + 1,
   * which loses one of them. The write names the count it read, so the loser
   * is told it matched nothing and reads again.
   */
  it("reads again when another message counted onto the row first", async () => {
    notificationFindFirstMock
      .mockResolvedValueOnce(unreadRow({ roomName: "general", count: 4 }))
      .mockResolvedValueOnce(unreadRow({ roomName: "general", count: 5 }));
    notificationUpdateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(2);

    const second = notificationUpdateManyMock.mock.calls[1]?.[0] as {
      data: { messageParams: string };
    };
    expect(JSON.parse(second.data.messageParams).count).toBe(6);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  /** A message that keeps losing is worth a row of its own, not silence. */
  it("gives up and writes a row after losing every attempt", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ roomName: "general" }),
    );
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(3);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  /**
   * `createNotification` refuses a duplicate emit on its own path, and this
   * one has to refuse it too: the row already stands for the message.
   */
  it("counts the same message once however often it arrives", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ roomName: "general" }, { messageId: MESSAGE_ID }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  /**
   * The reader's tab counts a row it does not hold towards the badge. This one
   * was counted the day it was written, so saying it is new puts the badge one
   * ahead of the server until the next reload.
   */
  it("publishes the counted row as a change rather than a new row", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ roomName: "general" }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(publishNotificationRowMock.mock.calls[0]?.[2]).toBe(false);
  });

  /**
   * A mention is about itself. Counting it onto a room's row would lose which
   * message named the reader.
   */
  it("leaves the row alone without the flag", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general" }),
    );

    await fanOutChatNotifications(params());

    expect(notificationFindFirstMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });
});

/** A stored row carrying this message's text, the way the fan-out wrote it. */
function storedRow(
  messageParams: Record<string, unknown>,
  messageId: string = MESSAGE_ID,
) {
  return {
    id: "notification_1",
    messageParams: JSON.stringify(messageParams),
    metadata: JSON.stringify({ messageId, workspaceId: "workspace_1" }),
  };
}

function paramsWrittenTo(call: number): Record<string, unknown> {
  const data = notificationUpdateManyMock.mock.calls[call]?.[0]?.data as {
    messageParams: string;
  };

  return JSON.parse(data.messageParams) as Record<string, unknown>;
}

describe("rewriteChatNotificationPreviews", () => {
  const BASE = {
    authorName: "Ada",
    roomName: "general",
    messagePreview: "meet at five",
  };

  /**
   * The message row keeps no text after a delete. A copy left on a
   * notification row would outlive it and stay readable over the API.
   */
  it("takes the text off the row when the message is deleted", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(paramsWrittenTo(0)).toEqual({
      authorName: "Ada",
      roomName: "general",
    });
  });

  it("leaves the rest of the row's params alone", async () => {
    notificationFindManyMock.mockResolvedValue([
      storedRow({ ...BASE, isGroup: true, count: 4 }),
    ]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(paramsWrittenTo(0)).toEqual({
      authorName: "Ada",
      roomName: "general",
      isGroup: true,
      count: 4,
    });
  });

  it("puts what the message now says on the row when it is edited", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);

    messageSays("meet at **six**");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(paramsWrittenTo(0)).toEqual({
      authorName: "Ada",
      roomName: "general",
      messagePreview: "meet at six",
    });
  });

  /**
   * The reader was sent what the row holds. An edit brings that up to date;
   * it does not put text on a row that was sent without any.
   */
  it("adds no text to a row that carried none", async () => {
    notificationFindManyMock.mockResolvedValue([
      storedRow({ authorName: "Ada", roomName: "general" }),
    ]);

    messageSays("meet at six");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
  });

  /**
   * A counted row names the last message counted onto it, so matching the id
   * as text only narrows the read. The parsed id is the answer.
   */
  it("leaves a row whose text came from another message", async () => {
    notificationFindManyMock.mockResolvedValue([
      storedRow(BASE, "550e8400-e29b-41d4-a716-4466554400ff"),
    ]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
  });

  /**
   * Another message can count onto the row between the read and the write.
   * The row then carries that message's text, which this delete must leave.
   */
  it("writes only to a row still carrying what it read", async () => {
    const row = storedRow(BASE);
    notificationFindManyMock.mockResolvedValue([row]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id, messageParams: row.messageParams },
      }),
    );
  });

  /**
   * One message writes one row per recipient, so the sweep has to reach all
   * of them. Stopping at the first leaves the text on everyone else.
   */
  it("takes the text off every recipient's row", async () => {
    notificationFindManyMock.mockResolvedValue([
      { ...storedRow(BASE), id: "notification_1" },
      { ...storedRow({ ...BASE, authorName: "Ben" }), id: "notification_2" },
    ]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(2);
    expect(paramsWrittenTo(1)).toEqual({
      authorName: "Ben",
      roomName: "general",
    });
  });

  /**
   * A row this sweep steps over is not a reason to stop: the rows after it
   * belong to other readers, who each still hold a copy of the message.
   */
  it("keeps going past a row it steps over", async () => {
    notificationFindManyMock.mockResolvedValue([
      { ...storedRow({ authorName: "Ada", roomName: "general" }), id: "n_1" },
      { ...storedRow(BASE), id: "n_2" },
    ]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "n_2" }),
      }),
    );
  });

  /** Same reason: one row nobody can read is not the other readers' problem. */
  it("keeps going past a row it cannot read", async () => {
    notificationFindManyMock.mockResolvedValue([
      {
        id: "n_1",
        messageParams: "{ not json",
        metadata: JSON.stringify({ messageId: MESSAGE_ID }),
      },
      { ...storedRow(BASE), id: "n_2" },
    ]);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "n_2" }),
      }),
    );
  });

  it("looks only at the chat rows of the room the message is in", async () => {
    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: NotificationKind.CHAT,
          referenceId: ROOM_ID,
          metadata: { contains: `"messageId":"${MESSAGE_ID}"` },
        },
      }),
    );
  });

  /**
   * The delete has already happened by the time this runs. Throwing here
   * would tell the reader their delete failed.
   */
  /**
   * A delete and an edit of the same message each read the row, then write it.
   * If the edit writes between the delete's read and its write, the delete's
   * guarded write matches nothing. Giving up there would leave the edited text
   * of a deleted message on the row for good.
   */
  it("reads the row again and writes when another writer got there first", async () => {
    const edited = {
      authorName: "Ada",
      roomName: "general",
      messagePreview: "the edited text",
    };
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    notificationFindUniqueMock.mockResolvedValue(storedRow(edited));

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "notification_1" },
      select: { id: true, messageParams: true, metadata: true },
    });
    // The row it names is the row it just read. Naming the params from before
    // the read loses every attempt, and the text stays on the row for good.
    expect(notificationUpdateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "notification_1", messageParams: JSON.stringify(edited) },
      }),
    );
    expect(paramsWrittenTo(1)).toEqual({
      authorName: "Ada",
      roomName: "general",
    });
  });

  /**
   * A later message counted onto the row while this write lost, so the row
   * now stands for that message. Its text belongs to the newer message.
   */
  it("leaves a row a newer message took over while it lost", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });
    notificationFindUniqueMock.mockResolvedValue(
      storedRow(BASE, "550e8400-e29b-41d4-a716-446655440009"),
    );

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  /** One row matched is the write landing. Writing again would be noise. */
  it("stops on a row as soon as the write lands", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });
    notificationFindUniqueMock.mockResolvedValue(storedRow(BASE));

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The other order. The delete wiped the row first, so the edit finds no text
   * to bring up to date and must not put any back.
   */
  it("adds no text back to a row another writer already wiped", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });
    notificationFindUniqueMock.mockResolvedValue(
      storedRow({ authorName: "Ada", roomName: "general" }),
    );

    messageSays("meet at six");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  /** A row that keeps losing must not read forever. */
  it("gives up on a row it keeps losing rather than reading forever", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });
    notificationFindUniqueMock.mockResolvedValue(storedRow(BASE));

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(3);
  });

  /** A row deleted between the write and the read has nothing left to fix. */
  it("stops on a row that is gone when it reads again", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock.mockResolvedValue({ count: 0 });
    notificationFindUniqueMock.mockResolvedValue(null);

    messageSays("");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });

    expect(notificationUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed read rather than failing the delete", async () => {
    notificationFindManyMock.mockRejectedValue(new Error("db is down"));

    await expect(
      rewriteChatNotificationPreviews({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("reports a failed write rather than failing the delete", async () => {
    notificationFindManyMock.mockResolvedValue([storedRow(BASE)]);
    notificationUpdateManyMock.mockRejectedValue(new Error("db is down"));

    await expect(
      rewriteChatNotificationPreviews({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalled();
  });
});

describe("preview rewrite ordering", () => {
  it("keeps the latest committed edit when an older request resumes", async () => {
    let row = storedRow({ messagePreview: "original" });
    notificationFindManyMock.mockImplementation(async () => [{ ...row }]);
    notificationUpdateManyMock.mockImplementation(async ({ where, data }) => {
      if (where.messageParams !== row.messageParams) return { count: 0 };
      row = { ...row, messageParams: data.messageParams };
      return { count: 1 };
    });
    messageSays("latest edit B");
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
    // Edit A resumes after its realtime publication. Its old body is not input.
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
    expect(JSON.parse(row.messageParams).messagePreview).toBe("latest edit B");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("reads the current message only after acquiring its lock", async () => {
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    queryRawMock.mockImplementationOnce(async () => {
      locked.resolve();
      await release.promise;
      messageSays("edit committed while waiting");
      return [];
    });
    notificationFindManyMock.mockResolvedValue([
      storedRow({ messagePreview: "old" }),
    ]);
    const rewrite = rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
    await locked.promise;
    expect(messageFindUniqueMock).not.toHaveBeenCalled();
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    release.resolve();
    await rewrite;
    expect(paramsWrittenTo(0)).toEqual({
      messagePreview: "edit committed while waiting",
    });
    const [sql, ...values] = queryRawMock.mock.calls[0];
    expect(sql.join("?")).toContain("FOR UPDATE");
    expect(values).toEqual([MESSAGE_ID, ROOM_ID]);
    expect(messageFindUniqueMock).toHaveBeenCalledWith({
      where: { id: MESSAGE_ID, roomId: ROOM_ID },
      select: { content: true, deletedAt: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it.each([null, { content: "old body", deletedAt: new Date() }])(
    "clears surviving text when the source is gone or deleted: %j",
    async (message) => {
      messageFindUniqueMock.mockResolvedValue(message);
      notificationFindManyMock.mockResolvedValue([
        storedRow({ messagePreview: "old" }),
      ]);
      await rewriteChatNotificationPreviews({
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
      });
      expect(paramsWrittenTo(0)).toEqual({});
    },
  );

  it("reports a failed lock without writing notification rows", async () => {
    const error = new Error("lock failed");
    queryRawMock.mockRejectedValueOnce(error);
    await rewriteChatNotificationPreviews({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
    expect(notificationUpdateManyMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).toHaveBeenCalledWith(error, expect.anything());
  });
});
