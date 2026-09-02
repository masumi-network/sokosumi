import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
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
});

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
