import { describe, expect, it } from "vitest";

import { notificationReducer } from "@/contexts/notification-provider";
import type { NotificationItem } from "@/lib/clients/generated/core";

function createNotification(
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id: "notification-1",
    userId: "user-1",
    kind: "JOB",
    referenceId: "job-1",
    eventId: "event-1",
    messageKey: "Notifications.Job.completed",
    messageParams: {},
    metadata: { agentId: "agent-1" },
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-18T09:00:00.000Z"),
    ...overrides,
  };
}

describe("notificationReducer", () => {
  it("ignores CHAT realtime events for the in-app feed", () => {
    const chatNotification = createNotification({
      id: "notification-chat",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.directMessage",
    });

    const afterRealtime = notificationReducer(
      { notifications: [], unreadCount: 0 },
      { type: "realtime", notification: chatNotification, created: true },
    );

    expect(afterRealtime.notifications).toEqual([]);
    expect(afterRealtime.unreadCount).toBe(0);
  });

  it("drops stale CHAT items on fetch_success instead of keeping them as pending", () => {
    const staleChat = createNotification({
      id: "notification-chat-stale",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.directMessage",
    });
    const job = createNotification({
      id: "notification-job",
      kind: "JOB",
    });

    const afterFetch = notificationReducer(
      { notifications: [staleChat], unreadCount: 1 },
      {
        type: "fetch_success",
        fetched: [job],
        serverUnreadCount: 1,
      },
    );

    expect(afterFetch.notifications.map((n) => n.id)).toEqual([job.id]);
    expect(afterFetch.unreadCount).toBe(1);
  });

  it("does not decrement in-app unread when mark-read succeeds for a CHAT not in the feed", () => {
    const job = createNotification({
      id: "notification-job",
      kind: "JOB",
    });
    const chatRead = createNotification({
      id: "notification-chat",
      kind: "CHAT",
      referenceId: "room-1",
      messageKey: "Notifications.Chat.directMessage",
      isRead: true,
      readAt: new Date("2026-06-18T10:00:00.000Z"),
    });

    const afterMarkRead = notificationReducer(
      { notifications: [job], unreadCount: 1 },
      {
        type: "mark_read_success",
        id: chatRead.id,
        updated: chatRead,
      },
    );

    expect(afterMarkRead.notifications).toEqual([job]);
    expect(afterMarkRead.unreadCount).toBe(1);
  });

  it("removes a notification and decrements unread when it was unread", () => {
    const unread = createNotification({ id: "n1", isRead: false });
    const read = createNotification({ id: "n2", isRead: true });

    const afterRemove = notificationReducer(
      { notifications: [unread, read], unreadCount: 1 },
      { type: "remove", id: "n1" },
    );

    expect(afterRemove.notifications.map((n) => n.id)).toEqual(["n2"]);
    expect(afterRemove.unreadCount).toBe(0);
  });

  it("removes a read notification without changing unread count", () => {
    const unread = createNotification({ id: "n1", isRead: false });
    const read = createNotification({ id: "n2", isRead: true });

    const afterRemove = notificationReducer(
      { notifications: [unread, read], unreadCount: 1 },
      { type: "remove", id: "n2" },
    );

    expect(afterRemove.notifications.map((n) => n.id)).toEqual(["n1"]);
    expect(afterRemove.unreadCount).toBe(1);
  });

  it("applies fetch and realtime updates atomically without losing unread count", () => {
    const realtimeNotification = createNotification({
      id: "notification-realtime",
    });
    const fetchedNotification = createNotification({
      id: "notification-fetched",
      isRead: true,
    });

    const afterRealtime = notificationReducer(
      { notifications: [], unreadCount: 0 },
      { type: "realtime", notification: realtimeNotification, created: true },
    );

    const afterFetch = notificationReducer(afterRealtime, {
      type: "fetch_success",
      fetched: [fetchedNotification],
      serverUnreadCount: 0,
    });

    expect(
      afterFetch.notifications.map((notification) => notification.id),
    ).toEqual(["notification-realtime", "notification-fetched"]);
    expect(afterFetch.unreadCount).toBe(1);
  });

  /**
   * A room's later messages arrive as changes to the row the first one wrote.
   * The reader can hold more unread rows than this list keeps, so a change can
   * land for a row the list has never seen, and counting it would put the
   * badge one ahead of the server for the rest of the session.
   */
  it("does not count a changed row the list never loaded", () => {
    const counted = createNotification({ id: "notification-counted" });

    const after = notificationReducer(
      { notifications: [], unreadCount: 12 },
      { type: "realtime", notification: counted, created: false },
    );

    expect(after.unreadCount).toBe(12);
    expect(after.notifications.map((one) => one.id)).toEqual([
      "notification-counted",
    ]);
  });

  it("counts a row the list never loaded when the event wrote it", () => {
    const written = createNotification({ id: "notification-written" });

    const after = notificationReducer(
      { notifications: [], unreadCount: 12 },
      { type: "realtime", notification: written, created: true },
    );

    expect(after.unreadCount).toBe(13);
  });

  /**
   * A room's row moves to the top of the feed when a message counts onto it.
   * Left where it was, the list would disagree with the order the next read
   * returns: the same rows, in a different order, for no reason the reader
   * can see.
   */
  it("moves a row that came back newer to the front", () => {
    const older = createNotification({
      id: "notification-room",
      createdAt: new Date("2026-01-01T09:00:00.000Z"),
    });
    const newer = createNotification({
      id: "notification-job",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
    });

    const loaded = notificationReducer(
      { notifications: [newer, older], unreadCount: 2 },
      {
        type: "realtime",
        notification: {
          ...older,
          createdAt: new Date("2026-01-01T11:00:00.000Z"),
        },
        created: false,
      },
    );

    expect(loaded.notifications.map((one) => one.id)).toEqual([
      "notification-room",
      "notification-job",
    ]);
    expect(loaded.unreadCount).toBe(2);
  });

  /**
   * A room read clears its rows on the server and says so over the same
   * channel. The badge has to come down with them.
   */
  it("takes a loaded row off the badge when it comes back read", () => {
    const unread = createNotification({ id: "notification-read-later" });

    const loaded = notificationReducer(
      { notifications: [], unreadCount: 0 },
      { type: "realtime", notification: unread, created: true },
    );

    const after = notificationReducer(loaded, {
      type: "realtime",
      notification: { ...unread, isRead: true },
      created: false,
    });

    expect(after.unreadCount).toBe(0);
  });

  it("does not double-count unread realtime items already included in server count", () => {
    const realtimeNotification = createNotification({
      id: "notification-realtime",
    });

    const afterRealtime = notificationReducer(
      { notifications: [], unreadCount: 0 },
      { type: "realtime", notification: realtimeNotification, created: true },
    );

    const afterFetch = notificationReducer(afterRealtime, {
      type: "fetch_success",
      fetched: [],
      serverUnreadCount: 1,
    });

    expect(afterFetch.unreadCount).toBe(1);
  });

  it("marks a notification read optimistically without waiting on the server payload", () => {
    const unread = createNotification({ id: "notification-unread" });

    const afterOptimistic = notificationReducer(
      { notifications: [unread], unreadCount: 1 },
      { type: "mark_read_optimistic", id: unread.id },
    );

    expect(afterOptimistic.notifications[0]?.isRead).toBe(true);
    expect(afterOptimistic.unreadCount).toBe(0);

    const serverUpdated = createNotification({
      id: unread.id,
      isRead: true,
      readAt: new Date("2026-06-18T10:00:00.000Z"),
    });

    const afterSuccess = notificationReducer(afterOptimistic, {
      type: "mark_read_success",
      id: unread.id,
      updated: serverUpdated,
    });

    expect(afterSuccess.notifications[0]).toEqual(serverUpdated);
    expect(afterSuccess.unreadCount).toBe(0);
  });

  it("is a no-op when optimistically marking an already-read notification", () => {
    const readNotification = createNotification({
      id: "notification-read",
      isRead: true,
      readAt: new Date("2026-06-18T09:30:00.000Z"),
    });
    const state = { notifications: [readNotification], unreadCount: 0 };

    const next = notificationReducer(state, {
      type: "mark_read_optimistic",
      id: readNotification.id,
    });

    expect(next).toBe(state);
  });
});
