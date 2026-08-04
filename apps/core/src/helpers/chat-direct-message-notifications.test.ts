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

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
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
