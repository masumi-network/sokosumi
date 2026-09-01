import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  preferenceFindManyMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  preferenceFindManyMock: vi.fn(),
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
    notificationPreference: {
      findMany: preferenceFindManyMock,
    },
  },
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

import {
  emitChatRoomMessageNotifications,
  shouldEmitChatRoomMessageNotifications,
} from "./chat-room-message-notifications";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const AUTHOR_ID = "user_author";
const SUBSCRIBER_ID = "user_alice";
const QUIET_ID = "user_bob";
const MENTIONED_ID = "user_carol";

/** Members of the room, as the membership query returns them. */
function members(...userIds: string[]) {
  return userIds.map((userId) => ({ userId }));
}

/** The rows of readers who turned every message in a room on. */
function optedIn(...userIds: string[]) {
  return userIds.map((userId) => ({ userId }));
}

function emit(excludeUserIds?: string[]) {
  return emitChatRoomMessageNotifications({
    roomId: ROOM_ID,
    roomName: "general",
    organizationId: "org_1",
    messageId: MESSAGE_ID,
    authorUserId: AUTHOR_ID,
    authorName: "Ada",
    ...(excludeUserIds ? { excludeUserIds } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
  preferenceFindManyMock.mockResolvedValue([]);
});

describe("shouldEmitChatRoomMessageNotifications", () => {
  it("covers a channel", () => {
    expect(shouldEmitChatRoomMessageNotifications({ kind: "channel" })).toBe(
      true,
    );
  });

  /** A direct message has its own row, and must not arrive twice. */
  it("leaves a direct room alone", () => {
    expect(shouldEmitChatRoomMessageNotifications({ kind: "direct" })).toBe(
      false,
    );
  });
});

describe("emitChatRoomMessageNotifications", () => {
  it("notifies the members who asked for every message", async () => {
    membershipFindManyMock
      .mockResolvedValueOnce(members(AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID))
      .mockResolvedValueOnce([]);
    preferenceFindManyMock.mockResolvedValue(optedIn(SUBSCRIBER_ID));

    await emit();

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: SUBSCRIBER_ID,
      kind: NotificationKind.CHAT,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: { authorName: "Ada", roomName: "general" },
      metadata: { messageId: MESSAGE_ID, workspaceId: "workspace_1" },
    });
  });

  /**
   * The row is off until the reader turns it on, so a room full of members who
   * never opened the settings page writes nothing at all.
   */
  it("writes nothing when nobody turned the row on", async () => {
    membershipFindManyMock.mockResolvedValue(
      members(AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID),
    );

    await emit();

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("asks only about the members of this room", async () => {
    membershipFindManyMock
      .mockResolvedValueOnce(members(AUTHOR_ID, SUBSCRIBER_ID))
      .mockResolvedValueOnce([]);
    preferenceFindManyMock.mockResolvedValue(optedIn(SUBSCRIBER_ID));

    await emit();

    expect(preferenceFindManyMock).toHaveBeenCalledWith({
      where: {
        userId: { in: [SUBSCRIBER_ID] },
        category: "CHAT_ROOM_MESSAGE",
        enabled: true,
      },
      select: { userId: true },
    });
  });

  /** The mention already arrived, so the same message must not arrive again. */
  it("skips a member the caller has already notified", async () => {
    membershipFindManyMock
      .mockResolvedValueOnce(members(AUTHOR_ID, SUBSCRIBER_ID, MENTIONED_ID))
      .mockResolvedValueOnce([]);
    preferenceFindManyMock.mockResolvedValue(
      optedIn(SUBSCRIBER_ID, MENTIONED_ID),
    );

    await emit([MENTIONED_ID]);

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SUBSCRIBER_ID }),
    );
  });

  it("skips a member who muted the room", async () => {
    membershipFindManyMock
      .mockResolvedValueOnce(members(AUTHOR_ID, SUBSCRIBER_ID))
      .mockResolvedValueOnce(members(SUBSCRIBER_ID));
    preferenceFindManyMock.mockResolvedValue(optedIn(SUBSCRIBER_ID));

    await emit();

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("never notifies the author of their own message", async () => {
    membershipFindManyMock
      .mockResolvedValueOnce(members(AUTHOR_ID))
      .mockResolvedValueOnce([]);
    preferenceFindManyMock.mockResolvedValue(optedIn(AUTHOR_ID));

    await emit();

    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});
