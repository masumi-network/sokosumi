import {
  CoworkerWorkspaceAccessStatus,
  NotificationKind,
  type Prisma,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";
import { jobForStatusComputeSelect } from "@sokosumi/database/types/job";
import {
  BROWSER_ONLY_NOTIFICATION_KINDS,
  CHAT_FEED_MESSAGE_KEYS,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  JOB_INPUT_REQUIRED_MESSAGE_KEY,
  NEEDS_ACTION_MESSAGE_KEYS,
  SokosumiJobStatus,
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

const BROWSER_ONLY_KIND_FILTER = [
  ...BROWSER_ONLY_NOTIFICATION_KINDS,
] as NotificationKind[];

/**
 * The rows a browser-only kind still sends to the feed.
 *
 * `CHAT_FEED_MESSAGE_KEYS` in `@sokosumi/utils` holds the list and says why
 * each key is on it. Web reads the same one, so the two cannot disagree about
 * which chat rows the feed holds.
 */
const BROWSER_ONLY_KIND_FEED_EXCEPTION: Prisma.NotificationWhereInput = {
  kind: { in: BROWSER_ONLY_KIND_FILTER },
  messageKey: { in: [...CHAT_FEED_MESSAGE_KEYS] },
};

/**
 * Prisma filter for the in-app notification feed (list, unread count,
 * mark-all-read).
 *
 * Two reasons a stored notification never reaches the feed, returned together
 * so a call site cannot apply one and forget the other: its kind is
 * browser-only, such as CHAT, and it is not one of that kind's exceptions; or
 * the reader silenced its category in the app.
 *
 * `requestedKinds` narrows on top rather than replacing the rule, so asking
 * for CHAT returns the mentions and room messages and nothing else.
 */
export function notificationFeedWhere(
  requestedKinds?: readonly NotificationKind[],
): Prisma.NotificationWhereInput {
  const feedWhere: Prisma.NotificationWhereInput = {
    inApp: true,
    OR: [
      { kind: { notIn: BROWSER_ONLY_KIND_FILTER } },
      BROWSER_ONLY_KIND_FEED_EXCEPTION,
    ],
  };

  if (requestedKinds && requestedKinds.length > 0) {
    return { ...feedWhere, kind: { in: [...requestedKinds] } };
  }

  return feedWhere;
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

/**
 * The feed clause for one reader, with the access requests that have been
 * answered already taken out. The list and the counts both start from here,
 * so neither can apply one exclusion and forget the other. `requestedKinds`
 * narrows as it does in `notificationFeedWhere`.
 */
export async function resolvedNotificationFeedWhere(
  userId: string,
  requestedKinds?: readonly NotificationKind[],
): Promise<Prisma.NotificationWhereInput> {
  const [staleVendorGrantReferenceIds, staleCoworkerAccessReferenceIds] =
    await Promise.all([
      findStaleVendorGrantNotificationReferenceIds(userId),
      findStaleCoworkerAccessNotificationReferenceIds(userId),
    ]);

  return {
    userId,
    ...notificationFeedWhere(requestedKinds),
    ...mergeAccessNotificationExclusions(
      excludeResolvedVendorGrantNotificationsWhere(
        staleVendorGrantReferenceIds,
      ),
      excludeResolvedCoworkerAccessNotificationsWhere(
        staleCoworkerAccessReferenceIds,
      ),
    ),
  };
}

interface NeedsActionCandidate {
  id: string;
  messageKey: string;
  referenceId: string;
}

/** One waiting record is one row: the key it asked with, and what it asked about. */
function recordKey(messageKey: string, referenceId: string): string {
  return `${messageKey}:${referenceId}`;
}

/**
 * Ids of the reader's notifications whose request is still open: the Needs
 * you view, decided from the record each row points at rather than from the
 * row, because a row is written once and never learns that its request was
 * answered. One id per waiting record, the newest, so a task that asked
 * twice is one row and one count.
 *
 * Returns ids rather than a where clause because a job's status is computed
 * from its events, not stored, so the answer cannot be a join. The list and
 * the counts route both read from here, which is what keeps the tab's number
 * equal to the rows under it.
 */
export async function findNeedsActionNotificationIds(
  userId: string,
): Promise<string[]> {
  const asked: NeedsActionCandidate[] = await prisma.notification.findMany({
    where: { userId, messageKey: { in: [...NEEDS_ACTION_MESSAGE_KEYS] } },
    select: { id: true, messageKey: true, referenceId: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const newestPerRecord = new Map<string, NeedsActionCandidate>();
  for (const candidate of asked) {
    if (candidate.referenceId.length === 0) continue;
    const key = recordKey(candidate.messageKey, candidate.referenceId);
    if (!newestPerRecord.has(key)) newestPerRecord.set(key, candidate);
  }
  const newest = [...newestPerRecord.values()];
  const referenceIdsFor = (messageKey: string): string[] =>
    newest
      .filter((candidate) => candidate.messageKey === messageKey)
      .map((candidate) => candidate.referenceId);

  const taskIds = referenceIdsFor(TASK_INPUT_REQUIRED_MESSAGE_KEY);
  const jobIds = referenceIdsFor(JOB_INPUT_REQUIRED_MESSAGE_KEY);
  const grantIds = referenceIdsFor(VENDOR_GRANT_PENDING_MESSAGE_KEY);
  const accessIds = referenceIdsFor(COWORKER_ACCESS_PENDING_MESSAGE_KEY);

  const [waitingTasks, jobs, pendingGrants, pendingAccesses] =
    await Promise.all([
      taskIds.length === 0
        ? []
        : prisma.task.findMany({
            where: { id: { in: taskIds }, status: TaskStatus.INPUT_REQUIRED },
            select: { id: true },
          }),
      jobIds.length === 0
        ? []
        : prisma.job.findMany({
            where: { id: { in: jobIds } },
            select: { id: true, ...jobForStatusComputeSelect },
          }),
      grantIds.length === 0
        ? []
        : prisma.vendorGrant.findMany({
            where: { id: { in: grantIds }, status: VendorGrantStatus.PENDING },
            select: { id: true },
          }),
      accessIds.length === 0
        ? []
        : prisma.coworkerWorkspaceAccess.findMany({
            where: {
              id: { in: accessIds },
              status: CoworkerWorkspaceAccessStatus.PENDING,
            },
            select: { id: true },
          }),
    ]);

  const waiting = new Set<string>([
    ...waitingTasks.map((task) =>
      recordKey(TASK_INPUT_REQUIRED_MESSAGE_KEY, task.id),
    ),
    ...jobs
      .filter(
        (job) => computeJobStatus(job) === SokosumiJobStatus.INPUT_REQUIRED,
      )
      .map((job) => recordKey(JOB_INPUT_REQUIRED_MESSAGE_KEY, job.id)),
    ...pendingGrants.map((grant) =>
      recordKey(VENDOR_GRANT_PENDING_MESSAGE_KEY, grant.id),
    ),
    ...pendingAccesses.map((access) =>
      recordKey(COWORKER_ACCESS_PENDING_MESSAGE_KEY, access.id),
    ),
  ]);

  return newest
    .filter((candidate) =>
      waiting.has(recordKey(candidate.messageKey, candidate.referenceId)),
    )
    .map((candidate) => candidate.id);
}
