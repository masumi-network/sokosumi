vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
}));

import { NotificationKind } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadDirectRoomNamesByReaderMock,
  createNotificationMock,
  workspaceFindUniqueMock,
  membershipFindManyMock,
  userFindManyMock,
  notificationFindFirstMock,
  resolveDeliveryMock,
} = vi.hoisted(() => ({
  loadDirectRoomNamesByReaderMock: vi.fn(),
  createNotificationMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  userFindManyMock: vi.fn(),
  notificationFindFirstMock: vi.fn(),
  resolveDeliveryMock: vi.fn(),
}));

vi.mock("@/helpers/notifications", () => ({
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
  // The counting write asks which channels the row would reach before it looks
  // for a row to count onto. Which channels those are is the fan-out's
  // question; this file asks who hears about the message at all.
  resolveDelivery: (...args: unknown[]) => resolveDeliveryMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    workspace: { findUnique: workspaceFindUniqueMock },
    chatRoomUserMember: { findMany: membershipFindManyMock },
    user: { findMany: userFindManyMock },
    // The fan-out looks for a row to count onto before it writes one.
    notification: { findFirst: notificationFindFirstMock },
    // It reads the message too, so a body deleted while it ran is not
    // written back onto the notifications.
    chatRoomMessage: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ deletedAt: null, content: "ship it" }),
    },
  },
}));

// A direct room is named per reader by its own helper, which has its own
// tests. Stubbed here so the room this file writes about has a known name.
vi.mock("@/helpers/chat-direct-room-names", () => ({
  loadDirectRoomNamesByReader: (...args: unknown[]) =>
    loadDirectRoomNamesByReaderMock(...args),
}));

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

import { publishChatRoomsChanged } from "@/lib/ably/publish";

import { emitChatRoomMessageCreatedEffects } from "./chat-room-message-created-effects";

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const AUTHOR_ID = "user_author";
const SUBSCRIBER_ID = "user_alice";
const QUIET_ID = "user_bob";
const MENTIONED_ID = "user_carol";

/** A reader who turned every message in a room on, both channels. */
function subscriber(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    pushOptIn: true,
    notificationPreferences: [
      { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
      { category: "CHAT_ROOM_MESSAGE", channel: "OS_BANNER", enabled: true },
    ],
    ...overrides,
  };
}

/** A reader who never opened the settings page: the row is off by default. */
function stranger(id: string) {
  return { id, pushOptIn: true, notificationPreferences: [] };
}

function emit(overrides: Record<string, unknown> = {}) {
  return emitChatRoomMessageCreatedEffects({
    roomId: ROOM_ID,
    roomName: "general",
    roomKind: "channel",
    organizationId: "org_1",
    messageId: MESSAGE_ID,
    content: "ship it",
    authorUserId: AUTHOR_ID,
    authorName: "Ada",
    memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createNotificationMock.mockResolvedValue({ created: true });
  workspaceFindUniqueMock.mockResolvedValue({ id: "workspace_1" });
  membershipFindManyMock.mockResolvedValue([]);
  userFindManyMock.mockResolvedValue([subscriber(SUBSCRIBER_ID)]);
  notificationFindFirstMock.mockResolvedValue(null);
  loadDirectRoomNamesByReaderMock.mockResolvedValue(new Map());
  resolveDeliveryMock.mockResolvedValue({ inApp: true, osBanner: true });
});

describe("emitChatRoomMessageCreatedEffects", () => {
  it("notifies the members who asked for every message", async () => {
    await emit();

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith({
      userId: SUBSCRIBER_ID,
      kind: NotificationKind.CHAT,
      referenceId: ROOM_ID,
      eventId: MESSAGE_ID,
      messageKey: "Notifications.Chat.roomMessage",
      messageParams: {
        authorName: "Ada",
        roomName: "general",
        messagePreview: "ship it",
      },
      metadata: { messageId: MESSAGE_ID, workspaceId: "workspace_1" },
    });
  });

  /**
   * The row is off until the reader turns it on, so a room full of members who
   * never opened the settings page writes nothing at all.
   */
  it("writes nothing when nobody turned the row on", async () => {
    userFindManyMock.mockResolvedValue([
      stranger(SUBSCRIBER_ID),
      stranger(QUIET_ID),
    ]);

    await emit({ memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID] });

    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(publishChatRoomsChanged).toHaveBeenCalledExactlyOnceWith({
      userIds: [AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID],
      roomId: ROOM_ID,
      collections: ["active"],
    });
  });

  /**
   * The banner is the only channel this reader kept, and account-wide push is
   * off, so nothing would reach them. Writing the row anyway would add one
   * notification per member per message that no surface ever shows.
   */
  it("writes nothing for a reader whose only channel is a banner they cannot receive", async () => {
    userFindManyMock.mockResolvedValue([
      subscriber(SUBSCRIBER_ID, {
        pushOptIn: false,
        notificationPreferences: [
          { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: false },
          {
            category: "CHAT_ROOM_MESSAGE",
            channel: "OS_BANNER",
            enabled: true,
          },
        ],
      }),
    ]);

    await emit();

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  /**
   * The other half of the same question: one channel is enough. A reader who
   * kept only the banner and opted in to push hears about the message, and so
   * does one who kept only the in-app row.
   */
  it("notifies a reader who kept one channel of the two", async () => {
    userFindManyMock.mockResolvedValue([
      subscriber(SUBSCRIBER_ID, {
        notificationPreferences: [
          { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: false },
          {
            category: "CHAT_ROOM_MESSAGE",
            channel: "OS_BANNER",
            enabled: true,
          },
        ],
      }),
      subscriber(QUIET_ID, {
        pushOptIn: false,
        notificationPreferences: [
          { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
          {
            category: "CHAT_ROOM_MESSAGE",
            channel: "OS_BANNER",
            enabled: false,
          },
        ],
      }),
    ]);

    await emit({ memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID] });

    expect(createNotificationMock).toHaveBeenCalledTimes(2);
  });

  it("asks only about the members of this room, and never about the author", async () => {
    await emit({ memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID] });

    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { id: { in: [SUBSCRIBER_ID] } },
      select: {
        id: true,
        pushOptIn: true,
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
      },
    });
  });

  it("reads this room's members when the caller has none to give", async () => {
    // The roster, then the mute check the fan-out makes with the same model.
    membershipFindManyMock
      .mockResolvedValueOnce([{ userId: AUTHOR_ID }, { userId: SUBSCRIBER_ID }])
      .mockResolvedValueOnce([]);

    await emit({ memberUserIds: undefined });

    expect(membershipFindManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID },
      select: { userId: true },
    });
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
  });

  /** The mention already arrived, so the same message must not arrive twice. */
  it("skips a member whose mention reaches them", async () => {
    userFindManyMock.mockResolvedValue([
      subscriber(SUBSCRIBER_ID),
      subscriber(MENTIONED_ID),
    ]);

    await emit({
      memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID, MENTIONED_ID],
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SUBSCRIBER_ID }),
    );
  });

  /**
   * Mentions off, every message on. Skipping this reader because the message
   * named them would leave them hearing about every message in the room except
   * the one addressed to them.
   */
  it("notifies a mentioned member who silenced mentions", async () => {
    userFindManyMock.mockResolvedValue([
      subscriber(MENTIONED_ID, {
        notificationPreferences: [
          { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
          {
            category: "CHAT_ROOM_MESSAGE",
            channel: "OS_BANNER",
            enabled: true,
          },
          { category: "CHAT_MENTION", channel: "IN_APP", enabled: false },
          { category: "CHAT_MENTION", channel: "OS_BANNER", enabled: false },
        ],
      }),
    ]);

    await emit({
      memberUserIds: [AUTHOR_ID, MENTIONED_ID],
      mentionedUserIds: [MENTIONED_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: MENTIONED_ID }),
    );
  });

  /** Two humans in a direct room: the direct-message row carries the message. */
  it("leaves a direct room to the direct-message row", async () => {
    await emit({ roomKind: "direct" });

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  /**
   * The direct-message row stops at two humans, so a bigger direct room is a
   * room like any other here. Without this it was the one place a message
   * reached nobody.
   */
  /**
   * A direct room that reaches this emitter has three or more people in it:
   * the smaller ones are covered by the direct-message row and returned
   * above. Its name is the list of who is in it, so the reader is told that
   * rather than being shown three names where a room name goes.
   */
  it("says a group direct room is a group, named as its reader sees it", async () => {
    loadDirectRoomNamesByReaderMock.mockResolvedValue(
      new Map([[SUBSCRIBER_ID, "Ada, Bob"]]),
    );

    await emit({
      roomKind: "direct",
      memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID],
      roomName: "Ada, Bob, Alice",
    });

    expect(loadDirectRoomNamesByReaderMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      readerUserIds: [SUBSCRIBER_ID],
    });
    expect(createNotificationMock.mock.calls[0]?.[0]).toMatchObject({
      messageParams: { roomName: "Ada, Bob", isGroup: true },
    });
  });

  it("never asks for a per-reader name in a named channel", async () => {
    await emit();

    expect(loadDirectRoomNamesByReaderMock).not.toHaveBeenCalled();
  });

  it("says nothing about groups for a named channel", async () => {
    await emit();

    expect(
      createNotificationMock.mock.calls[0]?.[0].messageParams,
    ).not.toHaveProperty("isGroup");
  });

  it("covers a direct room the direct-message row has given up on", async () => {
    userFindManyMock.mockResolvedValue([subscriber(SUBSCRIBER_ID)]);

    await emit({
      roomKind: "direct",
      memberUserIds: [AUTHOR_ID, SUBSCRIBER_ID, QUIET_ID],
    });

    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: SUBSCRIBER_ID }),
    );
  });

  it("skips a member who muted the room", async () => {
    membershipFindManyMock.mockResolvedValue([{ userId: SUBSCRIBER_ID }]);

    await emit();

    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("never notifies the author of their own message", async () => {
    userFindManyMock.mockResolvedValue([subscriber(AUTHOR_ID)]);

    await emit({ memberUserIds: [AUTHOR_ID] });

    expect(userFindManyMock).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
    expect(publishChatRoomsChanged).toHaveBeenCalledExactlyOnceWith({
      userIds: [AUTHOR_ID],
      roomId: ROOM_ID,
      collections: ["active"],
    });
  });
});
