import { NotificationKind, type Prisma } from "@sokosumi/database";

/**
 * Notification kinds that still create rows + Ably events (browser OS alerts,
 * chat room attention) but must not appear in the in-app notification center.
 */
export const BROWSER_ONLY_NOTIFICATION_KINDS = [
  NotificationKind.CHAT,
] as const satisfies readonly NotificationKind[];

const ALL_NOTIFICATION_KINDS = Object.values(
  NotificationKind,
) as NotificationKind[];

export function isBrowserOnlyNotificationKind(kind: NotificationKind): boolean {
  return (
    BROWSER_ONLY_NOTIFICATION_KINDS as readonly NotificationKind[]
  ).includes(kind);
}

/**
 * Prisma `kind` filter for the in-app notification feed (list, unread count,
 * mark-all-read). Always excludes browser-only kinds such as CHAT.
 */
export function notificationFeedKindWhere(
  requestedKinds?: readonly NotificationKind[],
): Prisma.EnumNotificationKindFilter {
  if (requestedKinds && requestedKinds.length > 0) {
    const feedKinds = requestedKinds.filter(
      (kind) => !isBrowserOnlyNotificationKind(kind),
    );

    if (feedKinds.length === 0) {
      // Explicit match-nothing: every known kind is excluded (no opaque `in: []`).
      return { notIn: ALL_NOTIFICATION_KINDS };
    }

    return { in: feedKinds };
  }

  return {
    notIn: [...BROWSER_ONLY_NOTIFICATION_KINDS],
  };
}
