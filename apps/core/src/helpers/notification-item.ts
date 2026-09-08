import type { Notification } from "@sokosumi/database";

/**
 * A stored notification as the API answers with it: JSON columns parsed, and
 * the storage-only fields left behind.
 *
 * One copy, because the list, the mark-read route and the delete route all
 * return the same shape and must not drift apart.
 */
export function mapNotificationToItem(notification: Notification) {
  return {
    id: notification.id,
    userId: notification.userId,
    kind: notification.kind,
    referenceId: notification.referenceId,
    eventId: notification.eventId,
    messageKey: notification.messageKey,
    messageParams: JSON.parse(notification.messageParams) as Record<
      string,
      unknown
    >,
    metadata: notification.metadata
      ? (JSON.parse(notification.metadata) as Record<string, unknown>)
      : null,
    isRead: notification.isRead,
    readAt: notification.readAt,
    createdAt: notification.createdAt,
  };
}
