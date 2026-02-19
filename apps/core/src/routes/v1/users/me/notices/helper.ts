import { conflict } from "@/helpers/error";

export interface NoticeRecord {
  id: string;
  bodyMarkdown: string;
  effectiveAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface FilterPendingNoticesParams<TNotice extends NoticeRecord> {
  notices: TNotice[];
  userCreatedAt: Date;
  acknowledgedNoticeIds: string[];
  now?: Date;
}

export function isNoticeApplicableToUser(
  notice: NoticeRecord,
  userCreatedAt: Date,
  now: Date = new Date(),
): boolean {
  return (
    notice.isActive &&
    notice.effectiveAt <= now &&
    userCreatedAt < notice.effectiveAt
  );
}

export function filterPendingNotices<TNotice extends NoticeRecord>({
  notices,
  userCreatedAt,
  acknowledgedNoticeIds,
  now = new Date(),
}: FilterPendingNoticesParams<TNotice>): TNotice[] {
  const acknowledgedSet = new Set(acknowledgedNoticeIds);

  return notices
    .filter(
      (notice) =>
        !acknowledgedSet.has(notice.id) &&
        isNoticeApplicableToUser(notice, userCreatedAt, now),
    )
    .sort((left, right) => {
      const effectiveAtDiff =
        left.effectiveAt.getTime() - right.effectiveAt.getTime();
      if (effectiveAtDiff !== 0) {
        return effectiveAtDiff;
      }

      return left.createdAt.getTime() - right.createdAt.getTime();
    });
}

export function getNoticeIneligibilityReason(
  notice: NoticeRecord,
  userCreatedAt: Date,
  now: Date = new Date(),
): string | null {
  if (!notice.isActive) {
    return "Notice is not active";
  }

  if (notice.effectiveAt > now) {
    return "Notice is not effective yet";
  }

  if (userCreatedAt >= notice.effectiveAt) {
    return "Notice is not applicable to this user";
  }

  return null;
}

export function assertNoticeIsAcknowledgeableForUser(
  notice: NoticeRecord,
  userCreatedAt: Date,
  now: Date = new Date(),
): void {
  const reason = getNoticeIneligibilityReason(notice, userCreatedAt, now);
  if (reason) {
    throw conflict(reason);
  }
}

export function getAcknowledgmentState(
  acknowledgedAt: Date | null,
  now: Date = new Date(),
): {
  acknowledgedAt: Date;
  alreadyAcknowledged: boolean;
} {
  if (acknowledgedAt) {
    return {
      acknowledgedAt,
      alreadyAcknowledged: true,
    };
  }

  return {
    acknowledgedAt: now,
    alreadyAcknowledged: false,
  };
}
