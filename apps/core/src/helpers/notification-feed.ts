import { NotificationKind, type Prisma } from "@sokosumi/database";

/**
 * Notification kinds that still create rows + Ably events (browser OS alerts,
 * chat room attention) but must not appear in the in-app notification center.
 */
export const BROWSER_ONLY_NOTIFICATION_KINDS = [
  NotificationKind.CHAT,
] as const satisfies readonly NotificationKind[];

/**
 * Prisma `kind` filter for the in-app notification feed (list, unread count,
 * mark-all-read). Always excludes browser-only kinds such as CHAT.
 */
export function notificationFeedKindWhere(
  requestedKinds?: readonly NotificationKind[],
): Prisma.EnumNotificationKindFilter {
  const browserOnly = new Set<NotificationKind>(
    BROWSER_ONLY_NOTIFICATION_KINDS,
  );

  if (requestedKinds && requestedKinds.length > 0) {
    return {
      in: requestedKinds.filter((kind) => !browserOnly.has(kind)),
    };
  }

  return {
    notIn: [...BROWSER_ONLY_NOTIFICATION_KINDS],
  };
}
