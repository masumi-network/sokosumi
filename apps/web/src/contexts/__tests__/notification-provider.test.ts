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
});
