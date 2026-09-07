import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  resolveDeliveryMock,
  publishNotificationRowMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  notificationFindFirstMock,
  notificationUpdateManyMock,
  notificationFindUniqueMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  resolveDeliveryMock: vi.fn(),
  publishNotificationRowMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationUpdateManyMock: vi.fn(),
  notificationFindUniqueMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  resolveDelivery: (...args: unknown[]) => resolveDeliveryMock(...args),
  publishNotificationRow: (...args: unknown[]) =>
    publishNotificationRowMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    notification: {
      findFirst: notificationFindFirstMock,
      updateMany: notificationUpdateManyMock,
      findUnique: notificationFindUniqueMock,
    },
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { fanOutChatNotifications } from "./chat-notification-fanout";

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

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
  notificationFindFirstMock.mockResolvedValue(null);
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
   * The preview is what a reader is shown on a lock screen, so the line is
   * written out here rather than built by calling the rule the code calls.
   */
  it("gives every recipient the same preview of the message", async () => {
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
