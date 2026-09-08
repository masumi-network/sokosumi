import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  userFindManyMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
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
    user: {
      findMany: userFindManyMock,
    },
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import {
  emitChatDirectMessageNotifications,
  shouldEmitChatDirectMessageNotifications,
} from "./chat-direct-message-notifications";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const AUTHOR_ID = "user_author";
const PEER_ID = "user_alice";
const OTHER_ID = "user_bob";
const THIRD_ID = "user_carol";

/** A reader who never opened the settings page: mentions still arrive. */
function reader(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pushOptIn: true,
    notificationPreferences: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
  userFindManyMock.mockResolvedValue([reader(PEER_ID)]);
});

describe("shouldEmitChatDirectMessageNotifications", () => {
  it("returns false for channel rooms regardless of member count", () => {
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "channel",
        memberUserIds: [AUTHOR_ID],
      }),
    ).toBe(false);
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "channel",
        memberUserIds: [AUTHOR_ID, PEER_ID],
      }),
    ).toBe(false);
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "channel",
        memberUserIds: [AUTHOR_ID, PEER_ID, OTHER_ID],
      }),
    ).toBe(false);
  });

  it("returns true for direct rooms with fewer than 3 human members", () => {
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "direct",
        memberUserIds: [AUTHOR_ID],
      }),
    ).toBe(true);
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "direct",
        memberUserIds: [AUTHOR_ID, PEER_ID],
      }),
    ).toBe(true);
  });

  it("returns false for direct rooms with 3 or more human members", () => {
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "direct",
        memberUserIds: [AUTHOR_ID, PEER_ID, OTHER_ID],
      }),
    ).toBe(false);
    expect(
      shouldEmitChatDirectMessageNotifications({
        kind: "direct",
        memberUserIds: [AUTHOR_ID, PEER_ID, OTHER_ID, THIRD_ID],
      }),
    ).toBe(false);
  });
});

describe("emitChatDirectMessageNotifications", () => {
  it("creates one CHAT notification per human recipient in a direct room", async () => {
    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Alice",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      recipientUserIds: [PEER_ID, OTHER_ID],
    });

    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        userId: { in: [PEER_ID, OTHER_ID] },
        mutedAt: { not: null },
      },
      select: { userId: true },
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: PEER_ID,
      kind: NotificationKind.CHAT,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.directMessage",
      messageParams: {
        authorName: "Patrick",
        roomName: "Alice",
      },
      metadata: {
        messageId: MESSAGE_ID,
        workspaceId: "workspace_1",
      },
    });
  });

  it("skips recipients who muted the room", async () => {
    membershipFindManyMock.mockResolvedValue([{ userId: PEER_ID }]);

    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Alice",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      recipientUserIds: [PEER_ID, OTHER_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_ID }),
    );
  });

  it("notifies all humans when the author is a coworker", async () => {
    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Hannah",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: null,
      authorName: "Hannah",
      recipientUserIds: [PEER_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: PEER_ID,
        messageParams: {
          authorName: "Hannah",
          roomName: "Hannah",
        },
      }),
    );
  });

  it("filters the author and no-ops when nobody remains", async () => {
    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Alice",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      recipientUserIds: [AUTHOR_ID],
    });

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
  });

  /**
   * Mentions still arrive, so the same message must not also land as a
   * direct-message row.
   */
  it("skips a mentioned recipient whose mention reaches them", async () => {
    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Alice",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      recipientUserIds: [PEER_ID],
      mentionedUserIds: [PEER_ID],
    });

    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: [PEER_ID] } },
      select: {
        id: true,
        pushOptIn: true,
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
      },
    });
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  /**
   * Mentions off, direct messages on. Skipping this reader because the
   * message named them would leave a 1:1 DM with no notification at all:
   * the room-message emitter also leaves this room alone.
   */
  it("notifies a mentioned recipient who silenced mentions", async () => {
    userFindManyMock.mockResolvedValue([
      reader(PEER_ID, {
        notificationPreferences: [
          { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
          { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
        ],
      }),
    ]);

    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Alice",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      recipientUserIds: [PEER_ID],
      mentionedUserIds: [PEER_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: PEER_ID,
        messageKey: "Notifications.Chat.directMessage",
      }),
    );
  });

  it("does not load readers when nobody named is a recipient", async () => {
    await emitChatDirectMessageNotifications({
      roomId: ROOM_ID,
      roomName: "Alice",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      recipientUserIds: [PEER_ID],
      mentionedUserIds: [OTHER_ID],
    });

    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("continues when createNotification fails for one recipient", async () => {
    createNotificationMock.mockRejectedValueOnce(new Error("db down"));

    await expect(
      emitChatDirectMessageNotifications({
        roomId: ROOM_ID,
        roomName: "Alice",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: AUTHOR_ID,
        authorName: "Patrick",
        recipientUserIds: [PEER_ID, OTHER_ID],
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
  });
});
