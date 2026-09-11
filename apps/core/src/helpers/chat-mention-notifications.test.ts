import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadDirectRoomNamesByReaderMock,
  createNotificationMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  captureExceptionMock,
} = vi.hoisted(() => ({
  loadDirectRoomNamesByReaderMock: vi.fn(),
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
    // The fan-out reads the message before it builds a preview, so a body
    // deleted while it ran is not written back onto the notifications.
    chatRoomMessage: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ deletedAt: null, content: "ship it" }),
    },
  },
}));

// Named per reader by its own helper, which has its own tests.
vi.mock("@/helpers/chat-direct-room-names", () => ({
  loadDirectRoomNamesByReader: (...args: unknown[]) =>
    loadDirectRoomNamesByReaderMock(...args),
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
  loadDirectRoomNamesByReaderMock.mockResolvedValue(
    new Map([[MENTIONED_ID, "Ada, Bob"]]),
  );
});

describe("emitChatMentionNotifications", () => {
  it("creates one CHAT notification per mentioned user", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      roomShape: "channel",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
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
        messagePreview: "ship it",
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
      roomShape: "channel",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
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
      roomShape: "channel",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
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
      roomShape: "channel",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
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
      roomShape: "channel",
      organizationId: null,
      messageId: MESSAGE_ID,
      content: "ship it",
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
        roomShape: "channel",
        organizationId: "org_1",
        messageId: MESSAGE_ID,
        content: "ship it",
        authorUserId: AUTHOR_ID,
        authorName: "Patrick",
        mentionedUserIds: [MENTIONED_ID, OTHER_ID],
      }),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalled();
    expect(createNotificationMock).toHaveBeenCalledTimes(2);
  });
  /**
   * Three rooms, three ways of saying where the reader was named. A channel
   * has its own name. A group is named after who is in it, which differs by
   * reader. A pair is named after the author, so it is not named at all.
   */
  it("names a group direct room the way its reader sees it", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "Ada, Bob, Carol",
      roomShape: "group",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(loadDirectRoomNamesByReaderMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      readerUserIds: [MENTIONED_ID],
    });
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      messageParams: { roomName: "Ada, Bob" },
    });
    expect(
      createNotificationMock.mock.calls[0]?.[0].messageParams,
    ).not.toHaveProperty("isDirect");
  });

  it("says a direct room of two is one, and does not name it", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "Patrick",
      roomShape: "pair",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(loadDirectRoomNamesByReaderMock).not.toHaveBeenCalled();
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      messageParams: { isDirect: true },
    });
  });

  it("leaves a channel to its own name", async () => {
    await emitChatMentionNotifications({
      roomId: ROOM_ID,
      roomName: "general",
      roomShape: "channel",
      organizationId: "org_1",
      messageId: MESSAGE_ID,
      content: "ship it",
      authorUserId: AUTHOR_ID,
      authorName: "Patrick",
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(loadDirectRoomNamesByReaderMock).not.toHaveBeenCalled();
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      messageParams: { roomName: "general" },
    });
    expect(
      createNotificationMock.mock.calls[0]?.[0].messageParams,
    ).not.toHaveProperty("isDirect");
  });
});
