import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createNotificationMock,
  workspaceFindUniqueMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
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
});

describe("emitChatMentionNotifications", () => {
  it("creates one SYSTEM notification per mentioned user with room metadata", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID, OTHER_ID],
    });

    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      select: { id: true },
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: MENTIONED_ID,
      kind: NotificationKind.SYSTEM,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.mentioned",
      messageParams: {
        authorName: "Patrick",
        roomName: "general",
      },
      metadata: {
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        workspaceId: "workspace_1",
        organizationId: "org_1",
      },
    });
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: OTHER_ID,
      kind: NotificationKind.SYSTEM,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.mentioned",
      messageParams: {
        authorName: "Patrick",
        roomName: "general",
      },
      metadata: {
        roomId: ROOM_ID,
        messageId: MESSAGE_ID,
        workspaceId: "workspace_1",
        organizationId: "org_1",
      },
    });
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
    expect(workspaceFindUniqueMock).not.toHaveBeenCalled();
  });

  it("sets workspaceId null when organizationId is null", async () => {
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
        metadata: expect.objectContaining({
          workspaceId: null,
          organizationId: null,
        }),
      }),
    );
  });

  it("swallows createNotification failures so callers stay healthy", async () => {
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
