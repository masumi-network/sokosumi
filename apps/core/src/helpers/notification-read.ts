import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma } from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import {
  TASK_ATTENTION_MESSAGE_KEYS,
  TASK_PARTICIPANT_ADDED_MESSAGE_KEY,
  TASK_SCHEDULE_REMOVED_MESSAGE_KEY,
  TASK_TERMINAL_MESSAGE_KEYS,
} from "@/helpers/notification-delivery";
import {
  cancelNotificationEmails,
  EMAILED_NOTIFICATION_COLUMNS,
} from "@/helpers/notification-email-dispatch";
import { notificationFeedWhere } from "@/helpers/notification-feed";
import prisma from "@/lib/db/prisma";

/**
 * Mark a reader's unread notification-center rows as read.
 *
 * `scope` narrows which of them, so read-all passes nothing and the batch
 * route passes the ids it was given. The feed rule and the reader's own
 * `userId` are applied here rather than by the caller, so a route cannot
 * reach a row the feed would never show, or someone else's row, by
 * forgetting one of them.
 *
 * Returns the ids of the room rows the write cleared: the counted room row is
 * the one a banner stands for, so it is the only row whose reading takes a
 * banner down. The rows come back from the write itself, so a notification
 * arriving during the request is published too if this write marked it read.
 *
 * An email scheduled for a cleared row is taken back here too, scheduled
 * rather than awaited so that a failed cancel cannot cost the reader the read.
 */
export async function markNotificationsRead(
  userId: string,
  scope: Prisma.NotificationWhereInput = {},
): Promise<{ count: number; clearedRoomIds: string[] }> {
  const clearedRows = await prisma.notification.updateManyAndReturn({
    where: {
      ...scope,
      userId,
      isRead: false,
      ...notificationFeedWhere(),
    },
    data: {
      isRead: true,
      readAt: new Date(),
    },
    select: { ...EMAILED_NOTIFICATION_COLUMNS, kind: true, messageKey: true },
  });

  waitUntil(cancelNotificationEmails(clearedRows));

  return {
    count: clearedRows.length,
    clearedRoomIds: clearedRows
      .filter(
        (row) =>
          row.kind === NotificationKind.CHAT &&
          row.messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY,
      )
      .map((row) => row.id),
  };
}

/**
 * The task attention keys cleared when work resumes or a run ends.
 *
 * Every one of them except the operator-removed schedule and a participant
 * added by @. The schedule row is about the schedule rather than the run.
 * Being mentioned is not a status question, so a resume must not mark it read.
 *
 * Archiving does end both, because nobody can open an archived task at all.
 * That case passes the full list itself, at `markTaskArchivedRead`.
 */
export const TASK_RUN_ATTENTION_MESSAGE_KEYS: readonly string[] =
  TASK_ATTENTION_MESSAGE_KEYS.filter(
    (key) =>
      key !== TASK_SCHEDULE_REMOVED_MESSAGE_KEY &&
      key !== TASK_PARTICIPANT_ADDED_MESSAGE_KEY,
  );

/**
 * The attention rows a settled record leaves behind, by the key that settled it.
 *
 * One map rather than a list plus a switch, for the same reason the follow-up
 * map is one: "is this key terminal" and "what does it clear" are one question.
 * A key absent from here clears nothing, which is the safe way round.
 */
const ATTENTION_KEYS_CLEARED_BY = new Map<string, readonly string[]>([
  ...TASK_TERMINAL_MESSAGE_KEYS.map((key): [string, readonly string[]] => [
    key,
    TASK_RUN_ATTENTION_MESSAGE_KEYS,
  ]),
]);

/**
 * Mark a record's outstanding attention rows read, because it has settled.
 *
 * Marking a notification read is how this product records that the thing it
 * was about has been dealt with. Until now only the reader could do that, by
 * opening the notification, the room or the task. A task canceled by a
 * teammate was dealt with by nobody, so its attention row stayed unread for
 * ever and the follow-up sync would remind the reader a day later to answer a
 * question that is no longer being asked (SOK-916 user stories 14 and 15).
 *
 * Done here rather than by the follow-up sync re-checking the record's status.
 * A re-check there would be a second, weaker copy of "this is no longer
 * waiting", it would only ever fix the one caller that asked, and it would
 * outlive the reason it was added. Written as a read, it is the same fact in
 * the same column every other reader of it already trusts: the badge, the
 * unread count and the feed all stop showing the row too, which is what a
 * settled record should do to them anyway.
 *
 * Best-effort, and reports rather than throws. Both callers are already
 * best-effort notification dispatch scheduled after their transaction
 * commits; a failure here must not cost the reader the outcome notification
 * that is being written next to it.
 */
export async function markSettledAttentionRead(
  userId: string,
  kind: NotificationKind,
  referenceId: string,
  settledByMessageKey: string,
): Promise<number> {
  const attentionKeys = ATTENTION_KEYS_CLEARED_BY.get(settledByMessageKey);

  if (!attentionKeys) {
    return 0;
  }

  return markAttentionRead(
    userId,
    kind,
    referenceId,
    attentionKeys,
    "settled-attention-read",
  );
}

/**
 * Mark a reader's outstanding attention rows for one record read.
 *
 * The write every caller shares, and the one place that decides what a failure
 * costs. Which keys stop waiting is the caller's question, because it
 * is a different question for a settled run, a reassignment and an archive.
 *
 * Best-effort, and reports rather than throws. Every caller is notification
 * work scheduled after its transaction has committed, so a failure here must
 * not cost the reader the write it sits next to, and must not undo the change
 * it is tidying up after. Returns the rows cleared, or zero when the write
 * failed. `notificationType` is what tells the two apart in Sentry.
 *
 * Written here rather than through `markNotificationsRead`, because the feed
 * rule that one applies does not belong to this question. A record settles
 * whether or not the reader sees its row in the app: a reader with In app
 * off and Email on has an email waiting on a row the feed would never show,
 * and leaving it to arrive asks them to answer a question nobody is asking,
 * which is the outcome this function exists to prevent. No room row can
 * match, so nothing here has a banner to take down.
 */
export async function markAttentionRead(
  userId: string,
  kind: NotificationKind,
  referenceId: string,
  messageKeys: readonly string[],
  notificationType: string,
): Promise<number> {
  try {
    const cleared = await prisma.notification.updateManyAndReturn({
      where: {
        userId,
        kind,
        referenceId,
        messageKey: { in: [...messageKeys] },
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
      select: EMAILED_NOTIFICATION_COLUMNS,
    });

    waitUntil(cancelNotificationEmails(cleared));

    return cleared.length;
  } catch (error) {
    Sentry.captureException(error, {
      extra: { userId, referenceId, notificationType },
    });

    return 0;
  }
}
