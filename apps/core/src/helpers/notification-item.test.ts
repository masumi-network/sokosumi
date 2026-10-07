import { type Notification, NotificationKind } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import { mapNotificationToItem } from "./notification-item";

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
}));

function row(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notification_1",
    userId: "user_1",
    workspaceId: null,
    organizationId: null,
    kind: NotificationKind.TASK,
    referenceId: "task_1",
    eventId: "event_1",
    messageKey: "Notifications.Task.completed",
    messageParams: JSON.stringify({ taskName: "Plan" }),
    metadata: JSON.stringify({ taskId: "task_1" }),
    isRead: false,
    readAt: null,
    createdAt: new Date("2026-06-16T15:00:00.000Z"),
    inApp: true,
    emailId: null,
    emailScheduledAt: null,
    publishId: null,
    publishPush: null,
    publishCreated: null,
    publishQueuedAt: null,
    publishNextAttemptAt: null,
    ...overrides,
  };
}

describe("mapNotificationToItem", () => {
  it("does not throw when a JSON column will not parse", () => {
    let item: ReturnType<typeof mapNotificationToItem> | undefined;

    expect(() => {
      item = mapNotificationToItem(
        row({
          messageParams: "{oh no",
          metadata: "also not json",
        }),
      );
    }).not.toThrow();

    expect(item?.messageParams).toEqual({});
    expect(item?.metadata).toBeNull();
  });
});
