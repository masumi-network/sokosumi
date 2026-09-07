import {
  CoworkerWorkspaceAccessStatus,
  NotificationKind,
  type Prisma,
  VendorGrantStatus,
} from "@sokosumi/database";
import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  isBrowserOnlyNotificationKind,
} from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

const ALL_NOTIFICATION_KINDS = Object.values(
  NotificationKind,
) as NotificationKind[];

const BROWSER_ONLY_KIND_FILTER = [
  ...BROWSER_ONLY_NOTIFICATION_KINDS,
] as NotificationKind[];

/** Message key for workspace vendor-grant request notifications. */
export const VENDOR_GRANT_PENDING_MESSAGE_KEY =
  "notifications.vendorGrant.pending";

/** Message key for coworker workspace early-access request notifications. */
export const COWORKER_ACCESS_PENDING_MESSAGE_KEY =
  "notifications.coworkerAccess.pending";

function notificationFeedKindWhere(
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

/**
 * Prisma filter for the in-app notification feed (list, unread count,
 * mark-all-read).
 *
 * Two reasons a stored notification never reaches the feed, returned together
 * so a call site cannot apply one and forget the other: its kind is
 * browser-only, such as CHAT, or the reader silenced its category in the app.
 */
export function notificationFeedWhere(
  requestedKinds?: readonly NotificationKind[],
): Prisma.NotificationWhereInput {
  return {
    kind: notificationFeedKindWhere(requestedKinds),
    inApp: true,
  };
}

/**
 * Exclude vendor-grant "pending" notifications whose grant is no longer PENDING
 * (GRANTED / DENIED / REVOKED) or whose grant row is missing.
 */
export function excludeResolvedVendorGrantNotificationsWhere(
  staleReferenceIds: string[],
): Prisma.NotificationWhereInput {
  if (staleReferenceIds.length === 0) {
    return {};
  }

  return {
    NOT: {
      AND: [
        { messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY },
        { referenceId: { in: staleReferenceIds } },
      ],
    },
  };
}

/**
 * Reference ids of pending-vendor-grant notifications for `userId` whose grant
 * is not currently PENDING (or is missing). Used to keep resolved requests out
 * of the feed even if cleanup on approve/deny was skipped.
 */
export async function findStaleVendorGrantNotificationReferenceIds(
  userId: string,
  prismaClient: {
    notification: {
      findMany: typeof prisma.notification.findMany;
    };
    vendorGrant: {
      findMany: typeof prisma.vendorGrant.findMany;
    };
  } = prisma,
): Promise<string[]> {
  const pendingNotifications = await prismaClient.notification.findMany({
    where: {
      userId,
      messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
    },
    select: { referenceId: true },
  });

  const referenceIds = [
    ...new Set(
      pendingNotifications
        .map((notification) => notification.referenceId)
        .filter((referenceId) => referenceId.length > 0),
    ),
  ];

  if (referenceIds.length === 0) {
    return [];
  }

  const grants = await prismaClient.vendorGrant.findMany({
    where: { id: { in: referenceIds } },
    select: { id: true, status: true },
  });

  const stillPendingIds = new Set(
    grants
      .filter((grant) => grant.status === VendorGrantStatus.PENDING)
      .map((grant) => grant.id),
  );

  return referenceIds.filter(
    (referenceId) => !stillPendingIds.has(referenceId),
  );
}

/**
 * Exclude coworker-access "pending" notifications whose access is no longer
 * PENDING (GRANTED / DENIED / REVOKED) or whose access row is missing.
 */
export function excludeResolvedCoworkerAccessNotificationsWhere(
  staleReferenceIds: string[],
): Prisma.NotificationWhereInput {
  if (staleReferenceIds.length === 0) {
    return {};
  }

  return {
    NOT: {
      AND: [
        { messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY },
        { referenceId: { in: staleReferenceIds } },
      ],
    },
  };
}

/**
 * Reference ids of pending-coworker-access notifications for `userId` whose
 * access row is not currently PENDING (or is missing). Keeps resolved
 * requests out of the feed even if cleanup on approve/deny was skipped.
 */
export async function findStaleCoworkerAccessNotificationReferenceIds(
  userId: string,
  prismaClient: {
    notification: {
      findMany: typeof prisma.notification.findMany;
    };
    coworkerWorkspaceAccess: {
      findMany: typeof prisma.coworkerWorkspaceAccess.findMany;
    };
  } = prisma,
): Promise<string[]> {
  const pendingNotifications = await prismaClient.notification.findMany({
    where: {
      userId,
      messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
    },
    select: { referenceId: true },
  });

  const referenceIds = [
    ...new Set(
      pendingNotifications
        .map((notification) => notification.referenceId)
        .filter((referenceId) => referenceId.length > 0),
    ),
  ];

  if (referenceIds.length === 0) {
    return [];
  }

  const accesses = await prismaClient.coworkerWorkspaceAccess.findMany({
    where: { id: { in: referenceIds } },
    select: { id: true, status: true },
  });

  const stillPendingIds = new Set(
    accesses
      .filter(
        (access) => access.status === CoworkerWorkspaceAccessStatus.PENDING,
      )
      .map((access) => access.id),
  );

  return referenceIds.filter(
    (referenceId) => !stillPendingIds.has(referenceId),
  );
}

/**
 * Merge independent access-request exclusion clauses (vendor grant, coworker
 * access, …). Empty clauses are dropped so callers keep a flat where shape.
 */
export function mergeAccessNotificationExclusions(
  ...clauses: Prisma.NotificationWhereInput[]
): Prisma.NotificationWhereInput {
  const nonEmpty = clauses.filter((clause) => Object.keys(clause).length > 0);
  if (nonEmpty.length === 0) {
    return {};
  }
  if (nonEmpty.length === 1) {
    return nonEmpty[0]!;
  }
  return { AND: nonEmpty };
}
