import type { Notification } from "@sokosumi/database";

import { readNotificationRowJson } from "./notification-row-json";

/**
 * A stored notification as the API answers with it: JSON columns parsed, and
 * the storage-only fields left behind.
 *
 * One copy, because list, mark-read, and mark-unread all return the same
 * shape and must not drift apart.
 */
export function mapNotificationToItem(notification: Notification) {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind,
    referenceId: notification.referenceId,
    eventId: notification.eventId,
    messageKey: notification.messageKey,
    messageParams:
      readNotificationRowJson(
        notification.messageParams,
        notification.id,
        "messageParams",
      ) ?? {},
    metadata: notification.metadata
      ? readNotificationRowJson(
          notification.metadata,
          notification.id,
          "metadata",
        )
      : null,
    isRead: notification.isRead,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}
