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

import { emitChatMentionNotifications } from "./chat-mention-notifications";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const AUTHOR_ID = "user_author";
const MENTIONED_ID = "user_alice";
const OTHER_ID = "user_bob";

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
});

describe("emitChatMentionNotifications", () => {
  it("creates one CHAT notification per mentioned user", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID, OTHER_ID],
    });

    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: {
        roomId: ROOM_ID,
        userId: { in: [MENTIONED_ID, OTHER_ID] },
        mutedAt: { not: null },
      },
      select: { userId: true },
    });
    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      select: { id: true },
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: MENTIONED_ID,
      kind: NotificationKind.CHAT,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.mentioned",
      messageParams: {
        authorName: "Patrick",
        roomName: "general",
      },
      metadata: {
        messageId: MESSAGE_ID,
        workspaceId: "workspace_1",
      },
    });
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_ID }),
    );
  });

  it("skips recipients who muted the room", async () => {
    membershipFindManyMock.mockResolvedValue([{ userId: MENTIONED_ID }]);

    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID, OTHER_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OTHER_ID }),
    );
    expect(createNotificationMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: MENTIONED_ID }),
    );
  });

  it("no-ops when every remaining recipient muted the room", async () => {
    membershipFindManyMock.mockResolvedValue([{ userId: MENTIONED_ID }]);

    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("filters the author and no-ops when nobody remains", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [AUTHOR_ID],
    });

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(membershipFindManyMock).not.toHaveBeenCalled();
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("skips workspace lookup when organizationId is null", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "dm",
      organizationId: null,
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MENTIONED_ID,
        metadata: {
          messageId: MESSAGE_ID,
          workspaceId: null,
        },
      }),
    );
  });

  it("continues when createNotification fails for one recipient", async () => {
    createNotificationMock.mockRejectedValueOnce(new Error("db down"));

    await expect(
      emitChatMentionNotifications({
        roomId: ROOM_ID,
        roomName: "general",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        authorUserId: AUTHOR_ID,
        authorName: "Patrick",
        mentionedUserIds: [MENTIONED_ID, OTHER_ID],
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
  });
});
