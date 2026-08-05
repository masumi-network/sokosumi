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
      { type: "realtime", notification: chatNotification },
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
      { type: "realtime", notification: realtimeNotification },
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

  it("does not double-count unread realtime items already included in server count", () => {
    const realtimeNotification = createNotification({
      id: "notification-realtime",
    });

    const afterRealtime = notificationReducer(
      { notifications: [], unreadCount: 0 },
      { type: "realtime", notification: realtimeNotification },
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
