import * as Sentry from "@sentry/node";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";
import {
  isFollowUpMessageKey,
  type NotificationCategory,
} from "@sokosumi/utils";

import { cancelEmail, sendEmail } from "@/clients/email.client";
import {
  hasCalendarWorkspaceAccess,
  lockCalendarWorkspaceMembership,
} from "@/helpers/calendar-membership-fence";
import { toNotificationCategory } from "@/helpers/notification-delivery";
import {
  buildNotificationEmail,
  notificationEmailDelayMs,
} from "@/helpers/notification-email";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import { hasAppInFront } from "@/lib/ably/channel-occupancy";
import prisma from "@/lib/db/prisma";

/**
 * Email the reader who is not looking (SOK-1090).
 *
 * Decided once, when the notification is written, rather than by a job that
 * wakes up to check. Nothing in front of the reader: the email goes now. The
 * app in front, as the tab they are on or the app in the foreground: Resend
 * is handed the email with a send time a few minutes out, and told to drop
 * it if the reader gets to the notification first. That is the whole mechanism;
 * there is no scheduler in this app.
 *
 * Meant for `waitUntil`. The reader's request has been answered by the time
 * this runs, and a caller inside a transaction has not committed yet, so it
 * waits for the row to become visible before it does anything.
 */

/**
 * Resend allows two requests a second. Every send and cancel one instance of
 * this app makes for notifications goes through one queue with this much
 * room between them, so a room mention with thirty readers is thirty
 * requests over fifteen seconds rather than thirty refusals.
 *
 * One instance, not the deployment: the queue is module state, and Vercel
 * runs concurrent invocations on separate instances. Two instances sending
 * at once can still be refused, and a refusal is reported and the email is
 * not retried.
 *
 * The queue is served inside `waitUntil`, which Vercel ends with the
 * invocation at `maxDuration` (300 seconds, in `apps/core/vercel.json`). So
 * roughly six hundred requests fit on one instance, and a room larger than
 * that loses the tail of its emails with nothing reported. Raising the
 * ceiling means asking Resend for more than two requests a second, not a
 * longer function.
 */
const RESEND_REQUEST_GAP_MS = 500;

/**
 * How long to wait for the row to commit, and how often to look.
 *
 * The vendor-grant and coworker-access requests write their notifications
 * inside the transaction that records the request. A transaction that takes
 * longer than this has been rolled back, or is slower than anything those
 * paths do, and the email is skipped rather than sent for a row that may not
 * exist.
 */
const COMMIT_WAIT_ATTEMPTS = 5;
const COMMIT_WAIT_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let resendQueue: Promise<unknown> = Promise.resolve();

/** Run one Resend request after the one before it, with the gap between. */
function withResendGap<T>(request: () => Promise<T>): Promise<T> {
  const next = resendQueue.then(request);

  resendQueue = next.then(
    () => sleep(RESEND_REQUEST_GAP_MS),
    () => sleep(RESEND_REQUEST_GAP_MS),
  );

  return next;
}

/**
 * The row as committed, or null when it never appeared.
 *
 * A row that never appears is a rolled-back transaction, which is nothing to
 * report, or one slower than the wait, which is: that email is dropped, and
 * the wait is the number to raise.
 */
async function committedRow(id: string): Promise<null | { isRead: boolean }> {
  for (let attempt = 0; attempt < COMMIT_WAIT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await sleep(COMMIT_WAIT_MS);
    }

    const row = await prisma.notification.findUnique({
      where: { id },
      select: { isRead: true },
    });

    if (row) {
      return row;
    }
  }

  Sentry.captureMessage("Notification row never committed; email skipped", {
    level: "warning",
    extra: { notificationId: id, notificationType: "notification-email" },
  });

  return null;
}

/**
 * The categories one email speaks for, besides itself.
 *
 * Everything a room can say is one email: a mention, a direct message and
 * the room's other messages are read as a whole when the reader opens it, so
 * whichever arrives first mails for all of them and the rest hold back
 * (SOK-1142). A task is the opposite case. The question it asked and the
 * finish it reports are cleared by different things, and a reader who turned
 * the finished-task email on expects it whether or not they answered the
 * question: an unread "schedule removed" row, which no run ends, would
 * otherwise hold every finish of that task out of the inbox for good.
 */
const SHARED_EMAIL_CATEGORIES: readonly NotificationCategory[] = [
  "CHAT_ROOM_MESSAGE",
  "CHAT_MENTION",
  "CHAT_DIRECT_MESSAGE",
];

function sameEmailScope(
  left: NotificationCategory,
  right: NotificationCategory | null,
): boolean {
  return (
    left === right ||
    (right !== null &&
      SHARED_EMAIL_CATEGORIES.includes(left) &&
      SHARED_EMAIL_CATEGORIES.includes(right))
  );
}

/**
 * Whether the reader was already emailed about this thing.
 *
 * One email per reader, reference and email scope while the earlier row is
 * unread: a task that asks for input and then for approval is one email.
 * Read is where that ends, because the reader has seen the first one by then.
 *
 * Only rows the reader can read count. Opening a room reads every row of the
 * room, hidden or not, so a hidden chat row that was emailed still speaks for
 * the room. A task or system row written with In app off is in no list the
 * reader can open (`notificationFeedWhere` keeps it out of every read there).
 * A banner click reaches it, and so does the write that clears a task's
 * attention rows when the run settles or its credits come back, and the one
 * that clears a request that was resolved, and archiving a task clears every
 * attention row it has. A finished task's row is reached by the click alone:
 * a reader who never clicks would otherwise have every later email about that
 * task held back for good. The cost: a reader with In app off and Email on is
 * mailed per event rather than per unread thing.
 *
 * The keys of a category are not listed anywhere on their own, so the rows
 * are read and sorted the way the delivery sorts them.
 */
async function alreadyEmailed(
  notification: Notification,
  category: NotificationCategory,
): Promise<boolean> {
  const earlier = await prisma.notification.findMany({
    where: {
      userId: notification.userId,
      kind: notification.kind,
      referenceId: notification.referenceId,
      ...(notification.kind === NotificationKind.CHAT ? {} : { inApp: true }),
      isRead: false,
      emailId: { not: null },
      id: { not: notification.id },
    },
    select: { messageKey: true },
  });

  return earlier.some(
    (row) =>
      (notification.kind !== NotificationKind.PROJECT ||
        row.messageKey === notification.messageKey) &&
      sameEmailScope(
        category,
        toNotificationCategory(notification.kind, row.messageKey),
      ),
  );
}

/**
 * Whether the reader has the app in front, with an unknown counted as no.
 *
 * No is the answer that still reaches the reader: the email goes now, and a
 * reader who was looking gets one email they could have done without. Yes
 * would hold the email back on an answer nobody gave.
 */
async function appInFront(notification: Notification): Promise<boolean> {
  try {
    return await hasAppInFront(notification.userId);
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        notificationId: notification.id,
        userId: notification.userId,
        notificationType: "notification-email-occupancy",
      },
    });

    return false;
  }
}

/**
 * Send, or schedule, the email for a notification that was just written.
 *
 * Never throws, and does nothing for a row that is not emailed at the event:
 * a category outside the delay table, a follow-up (its sync mails it), a key
 * inside an emailing category with no template. The caller has already asked
 * the reader's preferences; this asks everything else.
 */
export async function dispatchNotificationEmail(
  notification: Notification,
): Promise<void> {
  let unpersistedScheduledEmailId: string | null = null;
  try {
    if (isFollowUpMessageKey(notification.messageKey)) {
      return;
    }

    const category = toNotificationCategory(
      notification.kind,
      notification.messageKey,
    );
    const delayMs = notificationEmailDelayMs(category);

    if (category === null || delayMs === null) {
      return;
    }

    const row = await committedRow(notification.id);

    if (!row || row.isRead) {
      return;
    }

    const reader = await prisma.user.findUnique({
      where: { id: notification.userId },
      select: { email: true, name: true },
    });

    if (!reader) {
      return;
    }

    const messageParams = readNotificationRowJson(
      notification.messageParams,
      notification.id,
      "messageParams",
    );
    const metadata =
      notification.metadata === null
        ? null
        : readNotificationRowJson(
            notification.metadata,
            notification.id,
            "metadata",
          );

    // A column that will not read has been named by the reader above. No
    // email is built from half a row.
    if (
      messageParams === null ||
      (notification.metadata !== null && metadata === null)
    ) {
      return;
    }

    const email = await buildNotificationEmail({
      kind: notification.kind,
      referenceId: notification.referenceId,
      messageKey: notification.messageKey,
      messageParams,
      metadata,
      recipientEmail: reader.email,
      recipientName: reader.name,
    });

    if (!email) {
      return;
    }

    const scheduledAt = (await appInFront(notification))
      ? new Date(Date.now() + delayMs)
      : null;

    // The row's state, the earlier-email check, the send and the write are
    // one turn of the queue, so two notifications for one reader that arrive
    // together on one instance are asked one after the other: the second
    // sees the first's email on its row rather than both passing the check
    // before either has sent. Two instances can still both send; the row's
    // idempotency key does not cover that, since the rows differ.
    const sendForCurrentRecipient = async (
      client: Prisma.TransactionClient | typeof prisma,
    ) => {
      // Read again at this row's turn rather than before it. A room of
      // thirty waits half a second a row, and in that time the reader can
      // read the notification, or the request it is about can be resolved,
      // which takes the row away. Either way the email would ask for
      // something nobody is asking any more.
      const live = await client.notification.findUnique({
        where: { id: notification.id },
        select: { isRead: true },
      });

      if (!live || live.isRead) {
        return null;
      }

      if (
        notification.workspaceId &&
        !(await hasCalendarWorkspaceAccess(
          client,
          notification.workspaceId,
          notification.userId,
        ))
      ) {
        return null;
      }

      if (await alreadyEmailed(notification, category)) {
        return null;
      }

      const { id: emailId } = await sendEmail({
        ...email,
        ...(scheduledAt !== null
          ? { scheduledAt: scheduledAt.toISOString() }
          : {}),
        // One key per row, so a second run for one row never sends a
        // second email. A reader who is away repeats the same payload,
        // which Resend answers with the first send's id for a day. A reader
        // in front carries a later `scheduledAt`, which Resend refuses with
        // a 409 that is reported rather than sent.
        idempotencyKey: `notification-email/${notification.id}`,
      });

      if (scheduledAt !== null) unpersistedScheduledEmailId = emailId;

      // Written only onto a row that is still unread. A row read while the
      // email was being handed over has nothing to cancel it by, so it is
      // cancelled below instead; an email already on its way is left alone.
      const { count } = await client.notification.updateMany({
        where: { id: notification.id, isRead: false },
        data: { emailId, emailScheduledAt: scheduledAt },
      });

      return { emailId, count };
    };
    const sent = await withResendGap(() => {
      const workspaceId = notification.workspaceId;
      if (!workspaceId) return sendForCurrentRecipient(prisma);
      // Membership removal must see the provider ID before deleting the row.
      return prisma.$transaction(async (tx) => {
        await lockCalendarWorkspaceMembership(tx, workspaceId);
        return sendForCurrentRecipient(tx);
      });
    });

    if (sent !== null && sent.count === 0 && scheduledAt !== null) {
      await withResendGap(() => cancelEmail(sent.emailId));
    }
    unpersistedScheduledEmailId = null;
  } catch (error) {
    if (unpersistedScheduledEmailId) {
      const emailId = unpersistedScheduledEmailId;
      try {
        await withResendGap(() => cancelEmail(emailId));
      } catch (cancelError) {
        Sentry.captureException(cancelError, {
          extra: {
            emailId,
            notificationType: "notification-email-rollback-cancel",
          },
        });
      }
    }
    Sentry.captureException(error, {
      extra: {
        notificationId: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        messageKey: notification.messageKey,
        notificationType: "notification-email",
      },
    });
  }
}

/** The columns a read site hands over: what the row's email is, and when it leaves. */
export interface EmailedNotificationRow {
  id: string;
  emailId: null | string;
  emailScheduledAt: Date | null;
}

/**
 * Take back the emails scheduled for rows the reader has dealt with.
 *
 * Called from every place a row goes read or away: the Notification Center,
 * a room being opened, a task settling, a request being resolved, credits
 * being topped up. A row whose email already left is left alone, and one
 * that never had an email costs nothing.
 *
 * Never throws, and meant for `waitUntil`. A cancel that fails costs the
 * reader one email about something they have already seen, which is what
 * they would have got before this existed.
 *
 * The row is cleared with an `updateMany`, because a request that was
 * resolved deletes its rows in the same transaction and there is nothing
 * left to update by then.
 */
export async function cancelNotificationEmails(
  rows: readonly EmailedNotificationRow[],
  options: { retryOnFailure?: boolean } = {},
): Promise<void> {
  for (const row of rows) {
    const emailId = row.emailId;
    const scheduledAt = row.emailScheduledAt;

    if (!emailId || !scheduledAt) {
      continue;
    }

    try {
      // Whether the email is still waiting is asked at this row's turn in
      // the queue, not before it: an email due during the wait has left by
      // then, and cancelling it would be a refusal to report for nothing.
      const cancelled = await withResendGap(async () => {
        if (scheduledAt.getTime() <= Date.now()) {
          return false;
        }

        await cancelEmail(emailId);

        return true;
      });

      if (cancelled) {
        await prisma.notification.updateMany({
          where: { id: row.id },
          data: { emailId: null, emailScheduledAt: null },
        });
      }
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          notificationId: row.id,
          emailId,
          notificationType: "notification-email-cancel",
        },
      });
      if (options.retryOnFailure) throw error;
    }
  }
}

/** Every column `cancelNotificationEmails` needs, for a read site's `select`. */
export const EMAILED_NOTIFICATION_COLUMNS = {
  id: true,
  emailId: true,
  emailScheduledAt: true,
} as const;
