import { NotificationKind, type Prisma } from "@sokosumi/database";
import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  isBrowserOnlyNotificationKind,
} from "@sokosumi/utils";

const ALL_NOTIFICATION_KINDS = Object.values(
  NotificationKind,
) as NotificationKind[];

const BROWSER_ONLY_KIND_FILTER = [
  ...BROWSER_ONLY_NOTIFICATION_KINDS,
] as NotificationKind[];

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
    notIn: BROWSER_ONLY_KIND_FILTER,
  };
}
