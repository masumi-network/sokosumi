import type { Notification } from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, publish, access, capture } = vi.hoisted(() => ({
  db: {
    notification: { findUnique: vi.fn(), updateMany: vi.fn() },
    user: { findUnique: vi.fn() },
    chatRoomMessage: { findFirst: vi.fn() },
    chatRoomThreadReadState: { findUnique: vi.fn() },
  },
  publish: vi.fn(),
  access: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({ default: db }));
vi.mock("@/helpers/notifications", () => ({ publishNotificationRow: publish }));
vi.mock("@/routes/v1/chats/rooms/helpers", () => ({
  requireChatRoomUserAccess: access,
}));
vi.mock("@sentry/node", () => ({
  captureException: capture,
  captureMessage: vi.fn(),
}));

import {
  dispatchNotificationPublish,
  NOTIFICATION_PUBLISH_WINDOW_MS,
} from "./notification-publish";

const NOW = new Date("2026-09-21T10:00:00Z");
let row: Notification | null;
const reader = {
  pushOptIn: true,
  notificationPreferences: [
    { category: "TASK_COMPLETED", channel: "IN_APP", enabled: true },
    { category: "TASK_COMPLETED", channel: "OS_BANNER", enabled: true },
    { category: "CHAT_ROOM_MESSAGE", channel: "IN_APP", enabled: true },
    { category: "CHAT_ROOM_MESSAGE", channel: "OS_BANNER", enabled: true },
  ],
};
function pending(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "n1",
    userId: "u1",
    workspaceId: null,
    organizationId: null,
    kind: "TASK",
    referenceId: "task1",
    eventId: "e1",
    messageKey: "Notifications.Task.completed",
    messageParams: "{}",
    metadata: null,
    isRead: false,
    readAt: null,
    createdAt: NOW,
    inApp: true,
    emailId: null,
    emailScheduledAt: null,
    publishId: "revision1",
    publishPush: true,
    publishCreated: true,
    publishQueuedAt: NOW,
    publishNextAttemptAt: NOW,
    ...overrides,
  };
}
function chat(overrides: Partial<Notification> = {}) {
  row = pending({
    kind: "CHAT",
    referenceId: "room1",
    messageKey: "Notifications.Chat.roomMessage",
    metadata: '{"messageId":"m1"}',
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  row = pending();
  db.notification.findUnique.mockImplementation(async () => row && { ...row });
  db.notification.updateMany.mockImplementation(async ({ where, data }) => {
    if (
      !row ||
      row.id !== where.id ||
      row.publishId !== where.publishId ||
      (where.publishNextAttemptAt &&
        (!row.publishNextAttemptAt ||
          row.publishNextAttemptAt > where.publishNextAttemptAt.lte))
    )
      return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  db.user.findUnique.mockResolvedValue(reader);
  access.mockResolvedValue({ userMembers: [{ userId: "u1", mutedAt: null }] });
  db.chatRoomMessage.findFirst.mockResolvedValue({ parentMessageId: null });
  db.chatRoomThreadReadState.findUnique.mockResolvedValue(null);
  publish.mockResolvedValue(true);
});

describe("notification publish replay", () => {
  it("clears every pending field after acceptance", async () => {
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("published");
    expect(publish).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ osBanner: true }),
      true,
      expect.any(Object),
      "revision1",
    );
    expect(row).toMatchObject({
      publishId: null,
      publishPush: null,
      publishCreated: null,
      publishQueuedAt: null,
      publishNextAttemptAt: null,
    });
  });
  it("retries a failure after the lease with the same message id", async () => {
    publish.mockResolvedValueOnce(false);
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(
      await dispatchNotificationPublish("n1", new Date(NOW.getTime() + 60000)),
    ).toBe("published");
    expect(publish.mock.calls.map((call) => call[4])).toEqual([
      "revision1",
      "revision1",
    ]);
  });
  it("does not publish a row that has not committed", async () => {
    row = null;
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(publish).not.toHaveBeenCalled();
  });
  it("allows only one concurrent claim", async () => {
    await Promise.all([
      dispatchNotificationPublish("n1", NOW),
      dispatchNotificationPublish("n1", NOW),
    ]);
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it("does not clear a newer revision after an older send completes", async () => {
    publish.mockImplementation(async () => {
      row = pending({ publishId: "revision2" });
      return true;
    });
    await dispatchNotificationPublish("n1", NOW);
    expect(row?.publishId).toBe("revision2");
  });
  it("does not send a revision superseded during preference reads", async () => {
    db.user.findUnique.mockImplementation(async () => {
      row = pending({ publishId: "revision2" });
      return reader;
    });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(publish).not.toHaveBeenCalled();
  });
  it("uses the latest row contents", async () => {
    row = pending({
      messageParams: '{"taskName":"Updated"}',
      publishCreated: false,
    });
    await dispatchNotificationPublish("n1", NOW);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ messageParams: '{"taskName":"Updated"}' }),
      expect.any(Object),
      false,
      expect.any(Object),
      "revision1",
    );
  });
  it("does not restore original opt-out after later opt-in", async () => {
    row = pending({ publishPush: false });
    await dispatchNotificationPublish("n1", NOW);
    expect(publish.mock.calls[0]?.[1].osBanner).toBe(false);
  });
  it("recovers unknown initial consent after a successful preference read", async () => {
    row = pending({ publishPush: null });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("published");
    expect(publish.mock.calls[0]?.[1].osBanner).toBe(true);
  });
  it("keeps unknown consent pending while preferences cannot be read", async () => {
    row = pending({ publishPush: null });
    db.user.findUnique.mockRejectedValue(new Error("offline"));
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(row?.publishId).toBe("revision1");
    expect(publish).not.toHaveBeenCalled();
  });
  it("respects current opt-out when initial consent was unknown", async () => {
    row = pending({ publishPush: null });
    db.user.findUnique.mockResolvedValue({ ...reader, pushOptIn: false });
    await dispatchNotificationPublish("n1", NOW);
    expect(publish.mock.calls[0]?.[1].osBanner).toBe(false);
  });
  it("does not publish an unqueued historical row with null consent", async () => {
    row = pending({
      publishId: null,
      publishPush: null,
      publishQueuedAt: null,
      publishNextAttemptAt: null,
    });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(publish).not.toHaveBeenCalled();
  });
  it("respects current account opt-out", async () => {
    db.user.findUnique.mockResolvedValue({ ...reader, pushOptIn: false });
    await dispatchNotificationPublish("n1", NOW);
    expect(publish.mock.calls[0]?.[1].osBanner).toBe(false);
  });
  it("does not publish when all current channels are off", async () => {
    db.user.findUnique.mockResolvedValue({
      pushOptIn: false,
      notificationPreferences: [
        { category: "TASK_COMPLETED", channel: "IN_APP", enabled: false },
      ],
    });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
    expect(row?.publishId).toBeNull();
  });
  it("does not display a banner after the notification is read", async () => {
    db.user.findUnique.mockImplementation(async () => {
      if (row) row.isRead = true;
      return reader;
    });
    await dispatchNotificationPublish("n1", NOW);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ isRead: true }),
      expect.objectContaining({ osBanner: false }),
      false,
      expect.any(Object),
      "revision1",
    );
  });
  it("keeps work pending on a preference read failure", async () => {
    db.user.findUnique.mockRejectedValue(new Error("offline"));
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(row?.publishId).toBe("revision1");
    expect(publish).not.toHaveBeenCalled();
  });
  it("stops at the retry window", async () => {
    expect(
      await dispatchNotificationPublish(
        "n1",
        new Date(NOW.getTime() + NOTIFICATION_PUBLISH_WINDOW_MS),
      ),
    ).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
    expect(row?.publishId).toBeNull();
  });
  it("clears malformed JSON without publishing", async () => {
    row = pending({ messageParams: "bad" });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(row?.publishId).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });
  it("clears deleted accounts", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it.each([403, 404] as const)(
    "suppresses revoked chat access (%s)",
    async (status) => {
      chat();
      access.mockRejectedValue(new HTTPException(status));
      expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it("retains a chat access database failure", async () => {
    chat();
    access.mockRejectedValue(new Error("database offline"));
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("pending");
    expect(row?.publishId).toBe("revision1");
  });
  it("suppresses muted rooms", async () => {
    chat();
    access.mockResolvedValue({ userMembers: [{ userId: "u1", mutedAt: NOW }] });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("suppresses deleted messages", async () => {
    chat();
    db.chatRoomMessage.findFirst.mockResolvedValue(null);
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps a room aggregate when its latest message was deleted", async () => {
    chat({
      messageParams: JSON.stringify({
        count: 2,
        roomName: "Updates",
        authorName: "Deleted author",
        messagePreview: "Deleted text",
      }),
      metadata: JSON.stringify({ messageId: "deleted", workspaceId: "w1" }),
    });
    db.chatRoomMessage.findFirst.mockResolvedValue(null);

    expect(await dispatchNotificationPublish("n1", NOW)).toBe("published");
    const sent = publish.mock.calls[0]?.[0];
    expect(JSON.parse(sent.messageParams)).toEqual({
      count: 2,
      roomName: "Updates",
    });
    expect(JSON.parse(sent.metadata)).toEqual({ workspaceId: "w1" });
    expect(publish.mock.calls[0]?.[1].osBanner).toBe(true);
  });
  it.each([0, 1, 1.5, "2", null])(
    "does not infer an aggregate from count %s",
    async (count) => {
      chat({ messageParams: JSON.stringify({ count }) });
      db.chatRoomMessage.findFirst.mockResolvedValue(null);
      expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it("does not treat a counted mention as a room aggregate", async () => {
    chat({
      messageKey: "Notifications.Chat.mentioned",
      messageParams: '{"count":2}',
    });
    db.chatRoomMessage.findFirst.mockResolvedValue(null);
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps room mute for an aggregate with a deleted latest message", async () => {
    chat({ messageParams: '{"count":2}' });
    access.mockResolvedValue({ userMembers: [{ userId: "u1", mutedAt: NOW }] });
    db.chatRoomMessage.findFirst.mockResolvedValue(null);
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps current push opt-out for a room aggregate fallback", async () => {
    chat({ messageParams: '{"count":2}' });
    db.chatRoomMessage.findFirst.mockResolvedValue(null);
    db.user.findUnique.mockResolvedValue({ ...reader, pushOptIn: false });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("published");
    expect(publish.mock.calls[0]?.[1].osBanner).toBe(false);
  });
  it("keeps thread mute for a room aggregate", async () => {
    chat({ messageParams: '{"count":2}' });
    db.chatRoomMessage.findFirst.mockResolvedValue({ parentMessageId: "p1" });
    db.chatRoomThreadReadState.findUnique.mockResolvedValue({ mutedAt: NOW });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps thread mute when an aggregate's latest reply was deleted", async () => {
    chat({ messageParams: '{"count":2}' });
    db.chatRoomMessage.findFirst.mockResolvedValue({
      parentMessageId: "p1",
      deletedAt: NOW,
    });
    db.chatRoomThreadReadState.findUnique.mockResolvedValue({ mutedAt: NOW });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("suppresses a muted thread", async () => {
    chat();
    db.chatRoomMessage.findFirst.mockResolvedValue({
      parentMessageId: "parent1",
    });
    db.chatRoomThreadReadState.findUnique.mockResolvedValue({ mutedAt: NOW });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("skipped");
    expect(publish).not.toHaveBeenCalled();
  });
  it("keeps the mention exception to thread mute", async () => {
    chat({ messageKey: "Notifications.Chat.mentioned" });
    db.chatRoomMessage.findFirst.mockResolvedValue({
      parentMessageId: "parent1",
    });
    db.chatRoomThreadReadState.findUnique.mockResolvedValue({ mutedAt: NOW });
    expect(await dispatchNotificationPublish("n1", NOW)).toBe("published");
    expect(db.chatRoomThreadReadState.findUnique).not.toHaveBeenCalled();
  });
});
