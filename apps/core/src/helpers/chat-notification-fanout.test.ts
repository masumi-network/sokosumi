import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  resolveDeliveryMock,
  publishNotificationRowMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  notificationFindFirstMock,
  notificationUpdateMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  resolveDeliveryMock: vi.fn(),
  publishNotificationRowMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  notificationUpdateMock: vi.fn(),
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
      update: notificationUpdateMock,
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
  notificationUpdateMock.mockImplementation(
    ({ data }: { data: Record<string, unknown> }) => ({
      id: "notification_1",
      ...data,
    }),
  );
  resolveDeliveryMock.mockResolvedValue({ inApp: true, osBanner: false });
});

/** A row the reader already has for this room, unread. */
function unreadRow(messageParams: Record<string, unknown>) {
  return {
    id: "notification_1",
    userId: ALICE_ID,
    kind: NotificationKind.CHAT,
    referenceId: ROOM_ID,
    messageKey: "Notifications.Chat.roomMessage",
    messageParams: JSON.stringify(messageParams),
    isRead: false,
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
      messageParams: { authorName: "Patrick", roomName: "general" },
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

    expect(notificationUpdateMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      userId: ALICE_ID,
      referenceId: ROOM_ID,
      messageParams: { authorName: "Patrick", roomName: "general" },
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
    expect(notificationUpdateMock).toHaveBeenCalledTimes(1);

    const write = notificationUpdateMock.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { messageParams: string };
    };
    expect(write.where).toEqual({ id: "notification_1" });
    expect(JSON.parse(write.data.messageParams)).toEqual({
      authorName: "Patrick",
      roomName: "general",
      count: 2,
    });
  });

  it("carries the count on from the row it lands on", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general", count: 22 }),
    );

    await fanOutChatNotifications(params({ countPerRoom: true }));

    const write = notificationUpdateMock.mock.calls[0]?.[0] as {
      data: { messageParams: string };
    };
    expect(JSON.parse(write.data.messageParams).count).toBe(23);
  });

  /**
   * Read is where a group ends, which is what makes the count mean "since you
   * last looked". The row is found by `isRead: false`, so a read one is never
   * offered here.
   */
  it("looks only at the reader's unread row for this room", async () => {
    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationFindFirstMock).toHaveBeenCalledWith({
      where: {
        userId: ALICE_ID,
        kind: NotificationKind.CHAT,
        referenceId: ROOM_ID,
        messageKey: "Notifications.Chat.roomMessage",
        isRead: false,
      },
      orderBy: { createdAt: "desc" },
    });
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

  it("says nothing to a reader the row would reach on neither channel", async () => {
    notificationFindFirstMock.mockResolvedValue(
      unreadRow({ authorName: "Ada", roomName: "general" }),
    );
    resolveDeliveryMock.mockResolvedValue({ inApp: false, osBanner: false });

    await fanOutChatNotifications(params({ countPerRoom: true }));

    expect(notificationUpdateMock).toHaveBeenCalledTimes(1);
    expect(publishNotificationRowMock).not.toHaveBeenCalled();
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
    expect(notificationUpdateMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });
});
