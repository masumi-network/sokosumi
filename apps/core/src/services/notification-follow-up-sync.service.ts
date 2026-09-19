import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";
import {
  RESEND_BATCH_MAX_SIZE,
  type SendEmailInput,
  sendEmails,
} from "@/clients/email.client";
import {
  FOLLOW_UP_SOURCE_MESSAGE_KEYS,
  followUpEventId,
  followUpMessageKeyFor,
} from "@/helpers/notification-follow-up";
import { buildFollowUpEmail } from "@/helpers/notification-follow-up-email";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import type { CreateNotificationInput } from "@/helpers/notifications";
import { createNotification, resolveDelivery } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

/** How long a notification waits on the reader before it is said again. */
const NOTIFICATION_FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back of the day-old mark one run looks.
 *
 * The run is hourly, so a two-hour window reads each notification about twice
 * and survives one run that was late or never happened. The write is idempotent,
 * so reading one twice costs a query and changes nothing.
 *
 * Bounded on purpose. "Everything still unread after a day" grows without limit
 * and re-reads rows nobody will ever open. The price of the bound is that an
 * outage longer than the window loses the follow-ups inside it, which for a
 * reminder is the cheaper of the two failures.
 */
const NOTIFICATION_FOLLOW_UP_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * How many notifications one read returns.
 *
 * A page, not a cap on the run. The run pages through every eligible row,
 * oldest first, so a backlog larger than one read is no longer left behind by
 * a row count that had nothing to do with how much time the run had.
 *
 * This still does not promise every eligible row a reminder. The handler's
 * deadline ends a run wherever it falls, and what that costs depends on where
 * in the window the rows it did not reach sit. Consecutive windows overlap by
 * one hour, the newer half, so a row left behind in the newer half is read
 * again by the next run and a row left behind in the older half is not. The
 * run goes oldest first, so it reaches the older half first: losing those
 * takes a run too short to finish the oldest hour. `reachedEnd` on the result
 * says when the deadline ended a run, which is not the same as saying rows
 * were left: a run aborted before its first read reports it too.
 *
 * The deadline can land anywhere, page boundary or not, which is why it is
 * asked about per row and not only per page. The number below is the row cap
 * this used to have, kept as the page size because it was already far above
 * the rate this is expected to see. Nothing here was measured.
 */
export const NOTIFICATION_FOLLOW_UP_PAGE_SIZE = 500;

export interface SendFollowUpsOptions {
  now?: Date;
  /**
   * Ends the run wherever it has got to, the same as the deadline below.
   *
   * Asked before every read, before every row, and again after the reader's
   * preferences come back. One that arrives before the first read therefore
   * costs no query at all, and one that arrives mid-run costs only the row
   * in hand.
   */
  abortSignal?: AbortSignal;
  /**
   * Asked at the same three places as `abortSignal`: before every read,
   * before every row, and again after the reader's preferences come back. A
   * run therefore stops on the handler's deadline at a page boundary or
   * inside one.
   *
   * With neither this nor `abortSignal`, a run reads every eligible row. That
   * is bounded by the window rather than by anything here, so the cron route
   * passes both.
   */
  shouldContinue?: () => boolean;
}

export interface SendFollowUpsResult {
  /**
   * Notifications this run considered writing a follow-up for.
   *
   * Not the number of rows read. Each page reads one row past itself to learn
   * whether another page follows, and that row is counted only once the page
   * that handles it gets to it, which on a truncated run is never.
   */
  examined: number;
  /**
   * Follow-ups this run actually wrote.
   *
   * Lower than `examined` without anything being wrong, and by more than one
   * cause. Several rows about the same room or task on one day share one
   * reminder, so all but the first are refused as duplicates. A source row
   * also stays unread after its follow-up, so while it remains in the window a
   * later run reads it again and is refused the same way. Readers who silenced
   * the category are skipped before the write, and so is a row whose message
   * parameters will not read. How much of the gap is any of those, against how
   * much is failed writes, is not something this says: the failures are the
   * ones in Sentry.
   */
  sent: number;
  /**
   * Reminder emails this run handed to Resend.
   *
   * Never higher than `sent`, because an email is built only for a follow-up
   * that was actually written. Lower when readers have switched the email cell
   * off, and lower when a chunk was refused: a refused chunk is reported to
   * Sentry and counted nowhere, because nothing in it arrived.
   *
   * Handed over, not delivered. What Resend does with a batch afterwards is
   * not something this run can see.
   */
  emailed: number;
  /**
   * Whether the run reached the end of the eligible rows.
   *
   * False when the deadline or an abort ended it first, including an abort
   * that arrived before the first read, where nothing is known about who was
   * waiting. Whether anything was lost depends on how far through the window
   * the run got, which this does not say: it is the signal that the deadline,
   * not the work, is deciding how much gets done.
   *
   * True does not mean nothing was lost. A row whose write throws is caught,
   * reported to Sentry, and left out of `sent` while the run carries on to
   * the end.
   */
  reachedEnd: boolean;
}

/**
 * The columns a follow-up is built from.
 *
 * Named once and used as the query's `select`, so the read asks for exactly
 * what is read and Prisma types `FollowUpSource` from the same list. The type
 * and the read cannot then drift apart, and neither can drift from the schema
 * without a type error.
 */
const FOLLOW_UP_SOURCE_COLUMNS = {
  id: true,
  // Two jobs. The next page continues after this row's position, and the
  // position is (createdAt, id). It is also the day the follow-up's event id
  // is scoped to, so that one room's reminder does not mute the room for good.
  createdAt: true,
  userId: true,
  kind: true,
  referenceId: true,
  messageKey: true,
  messageParams: true,
  metadata: true,
} as const;

type FollowUpSource = Prisma.NotificationGetPayload<{
  select: typeof FOLLOW_UP_SOURCE_COLUMNS;
}>;

/** Where a reminder email is sent, and who it greets. */
interface FollowUpReader {
  email: string;
  name: null | string;
}

/**
 * Reads the reader an email is about to be addressed to, once per run.
 *
 * A separate read rather than a column on the notification, because
 * `Notification` carries a `userId` and no `user` relation: the model declares
 * no relation field, so a `select` naming one resolves to `never` rather than
 * to a row.
 *
 * Cached for the run, and only ever consulted for a reminder that is going to
 * be emailed. A reader with three rooms waiting costs one read, and a run
 * where nobody wants reminder emails costs none. The cache holds the misses
 * too, so a deleted account is not asked about once per row.
 *
 * Never throws. The follow-up notification is already written by the time this
 * is called, and a failed read must cost the email alone.
 */
function createReaderCache() {
  const readers = new Map<string, FollowUpReader | null>();

  return async function readerFor(
    userId: string,
  ): Promise<FollowUpReader | null> {
    const cached = readers.get(userId);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const reader = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });

      readers.set(userId, reader);

      return reader;
    } catch (error) {
      Sentry.captureException(error, {
        extra: { userId, notificationType: "notification-follow-up-reader" },
      });
      readers.set(userId, null);

      return null;
    }
  };
}

/**
 * The follow-up this notification would be, or null when it is not one to send.
 *
 * A source key with no mapping is skipped rather than guessed at. The query
 * already asks only for mapped keys, so that half answers for the type rather
 * than for anything that path produces. A row whose message parameters will
 * not read is skipped for a reason that is not about types at all, and that
 * one does happen.
 */
function toFollowUpInput(
  source: FollowUpSource,
): CreateNotificationInput | null {
  const messageKey = followUpMessageKeyFor(source.messageKey);

  if (!messageKey) {
    return null;
  }

  // The reminder says what the original said, so it carries what the original
  // carried: the same parameters for the words, the same metadata for the
  // destination.
  //
  // A row whose parameters will not read is skipped rather than reminded
  // about without them. It used to be reminded about with an empty object, on
  // the grounds that a reminder missing a name beats no reminder. That stopped
  // being true when reminders started sharing one event id per room and day: a
  // wordless reminder built from the oldest row would take the key, and the
  // healthy rows behind it could no longer produce a correct one. The damaged
  // row is already reported by `readNotificationRowJson`.
  const messageParams = readNotificationRowJson(
    source.messageParams,
    source.id,
    "messageParams",
  );

  if (!messageParams) {
    return null;
  }
  // Metadata is not held to the same bar. It decides where the reminder opens
  // rather than what it says, and a row that legitimately carries none is
  // indistinguishable here from one whose metadata will not read, so refusing
  // on it would refuse reminders that are fine.
  const metadata = source.metadata
    ? readNotificationRowJson(source.metadata, source.id, "metadata")
    : null;

  return {
    userId: source.userId,
    kind: source.kind,
    referenceId: source.referenceId,
    eventId: followUpEventId(source.referenceId, source.createdAt),
    messageKey,
    messageParams,
    metadata,
  };
}

/**
 * Hand a batch of reminder emails to Resend.
 *
 * Empties what it is given, so a caller can flush repeatedly through a run
 * without tracking what already went. Returns how many Resend accepted.
 *
 * Chunked here rather than handed over whole, even though `sendEmails` chunks
 * again inside. It throws on the first chunk Resend refuses and says nothing
 * about the rest, so one refusal in the middle of a page would both lose the
 * emails behind it and report the ones in front of it as unsent. The
 * follow-up rows are already written, and the next run refuses them as
 * duplicates, so those readers would never be mailed at all. Chunking here
 * costs one refused chunk instead.
 *
 * Never throws. A refused chunk goes to Sentry and the run carries on: it
 * must not cost the rest of the work or make it look like the reminders
 * themselves failed.
 */
async function flushFollowUpEmails(pending: SendEmailInput[]): Promise<number> {
  if (pending.length === 0) {
    return 0;
  }

  const batch = pending.splice(0, pending.length);
  let accepted = 0;

  for (let offset = 0; offset < batch.length; offset += RESEND_BATCH_MAX_SIZE) {
    const chunk = batch.slice(offset, offset + RESEND_BATCH_MAX_SIZE);

    try {
      await sendEmails(chunk);

      accepted += chunk.length;
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          batchSize: chunk.length,
          notificationType: "notification-follow-up-email",
        },
      });
    }
  }

  return accepted;
}

/**
 * Say once more what nobody opened (SOK-916).
 *
 * A notification that waits on the reader and is still unread a day later gets
 * exactly one follow-up. Unread is the whole of the signal: opening the room,
 * the notification or the task all mark it read, so a row still unread is one
 * nothing has happened to.
 *
 * Only rows that were delivered in the app are eligible. A notification the
 * reader's preferences silenced was stored with that decision on it, and
 * reminding someone of what they switched off would be the feature working
 * against them.
 *
 * One follow-up per thing per day. The event id is derived from what is being
 * reminded about and the day it arrived, rather than from the row that
 * triggered it, so the uniqueness the notification table already enforces is
 * what stops the second, and this needs no record of its own that a run
 * happened. Twenty unread mentions in one room are twenty rows and one
 * reminder; a mention in the same room next week is a reminder again.
 *
 * A row whose write throws costs that one reminder and nothing else: the run
 * carries on through the rest. The preference read sits inside the same try,
 * so it is covered too, but `resolveDelivery` answers with a fallback rather
 * than throwing, so everything Sentry reports from here is a failed write.
 * Failed reads are reported by that helper instead, under the error type
 * `notification-delivery-read`.
 *
 * Whether the next run finds that row again depends on where in the window it
 * sits: rows in the newer half are read again, rows in the older half are not.
 */
export async function sendFollowUps(
  options: SendFollowUpsOptions = {},
): Promise<SendFollowUpsResult> {
  const now = options.now ?? new Date();
  const waitedUntil = new Date(now.getTime() - NOTIFICATION_FOLLOW_UP_DELAY_MS);
  const windowOpened = new Date(
    waitedUntil.getTime() - NOTIFICATION_FOLLOW_UP_WINDOW_MS,
  );

  /** Whether the handler has stopped wanting this run to do more work. */
  const outOfTime = () =>
    options.abortSignal?.aborted === true ||
    options.shouldContinue?.() === false;

  let examined = 0;
  let sent = 0;
  let emailed = 0;
  /** Reminder emails written this page, handed over when the page ends. */
  const pendingEmails: SendEmailInput[] = [];
  const readerFor = createReaderCache();
  /** The last row this run finished, and where the next page starts after. */
  let after: { createdAt: Date; id: string } | undefined;
  /** Whether the run ended before the eligible rows did. */
  let stopped = false;

  // Every way out is a `break`, so the condition is not the thing that ends
  // this. The flag carries the reason out instead: an inner `break` leaves
  // only the page, and the guard after the page reads the flag to end the
  // run as well. `reachedEnd` then reports it.
  while (true) {
    if (outOfTime()) {
      stopped = true;
      break;
    }

    const sources = await prisma.notification.findMany({
      select: FOLLOW_UP_SOURCE_COLUMNS,
      where: {
        isRead: false,
        inApp: true,
        messageKey: { in: [...FOLLOW_UP_SOURCE_MESSAGE_KEYS] },
        createdAt: {
          // The first page opens at the window. Every later one opens at the
          // instant the last page ended on, so a read that goes by `createdAt`
          // can start there rather than at the window and walk over the rows
          // already handled. Whether it does was not measured: no `EXPLAIN`
          // was taken. The paging clause below decides either way; this only
          // narrows where to start looking.
          ...(after === undefined
            ? { gt: windowOpened }
            : { gte: after.createdAt }),
          lte: waitedUntil,
        },
        // Where the last page ended, said as a plain filter rather than
        // Prisma's `cursor`. A follow-up leaves its source row unread, so the
        // next page cannot be "whatever still matches" and has to continue
        // from a position. `cursor` names that position by row id and the row
        // has to still be there for the next page to start; the pair of values
        // below is held in memory instead, so a row that goes away between two
        // pages cannot lose the place. Whether `cursor` would in fact stumble
        // there was not established: the Prisma documentation does not say
        // whether the cursor row must still match `where`, and no test here
        // pins it.
        ...(after === undefined
          ? {}
          : {
              OR: [
                { createdAt: { gt: after.createdAt } },
                { createdAt: after.createdAt, id: { gt: after.id } },
              ],
            }),
      },
      // `createdAt` alone leaves the order of two rows in the same instant to
      // chance, and the filter above would then skip or repeat them.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      // One more than the page, to learn whether another page exists without
      // reading again. Without it a backlog that is an exact multiple of the
      // page costs an extra turn of the loop, and a deadline landing on that
      // turn reports a run that finished everything as one that ran out.
      take: NOTIFICATION_FOLLOW_UP_PAGE_SIZE + 1,
    });

    const hasMore = sources.length > NOTIFICATION_FOLLOW_UP_PAGE_SIZE;
    const page = sources.slice(0, NOTIFICATION_FOLLOW_UP_PAGE_SIZE);

    for (const source of page) {
      if (outOfTime()) {
        stopped = true;
        break;
      }

      examined += 1;

      const input = toFollowUpInput(source);

      if (!input) {
        continue;
      }

      try {
        // Asked before the write rather than left to the create path, which
        // stores a hidden row for readers who silenced the category. A hidden
        // reminder reaches nobody and would still be there to explain later.
        // The one exception is a reader who kept the email: that row is what
        // makes the email the only one, so it is worth storing unseen.
        const delivery = await resolveDelivery(input);

        // Asked again. The read above is itself an await, so it can be the
        // thing that crosses the deadline, and the check at the top of the
        // loop answered for a moment that has passed.
        if (outOfTime()) {
          stopped = true;
          break;
        }

        // A guess is not an answer here. Everywhere else this read only
        // decides the banner on a row that was going to be written; here it
        // decides whether to write, and its fallback says yes for a reader
        // who may have switched the reminder off. The row stays unread, so
        // the next run reads it again while the window still holds it.
        if (delivery.fellBack) {
          continue;
        }

        // Nowhere to put it and nobody to mail it. Email counts here, or the
        // reminder row's email cell would be a switch that controls nothing
        // for a reader who turned the two cells beside it off (SOK-916).
        if (!delivery.inApp && !delivery.osBanner && !delivery.email) {
          continue;
        }

        // The answer above, not a second read. Between two reads the reader
        // can switch the category off, and the write would then store a row
        // nobody sees while this run counted a reminder as sent.
        const { created } = await createNotification(input, prisma, delivery);

        if (!created) {
          continue;
        }

        sent += 1;

        // Only for a row this run actually wrote, which is what makes one
        // email per reminder true. The uniqueness the notification table
        // enforces already stops the second reminder, so it stops the second
        // email too, with no second mechanism to keep in step.
        if (!delivery.email) {
          continue;
        }

        const reader = await readerFor(input.userId);

        if (!reader) {
          continue;
        }

        const email = await buildFollowUpEmail({
          kind: input.kind,
          messageKey: input.messageKey,
          messageParams: input.messageParams,
          metadata: input.metadata,
          recipientEmail: reader.email,
          recipientName: reader.name,
          referenceId: input.referenceId,
          // The key of the row being reminded about, not the reminder's own.
          // The reminder collapses a family to one key on purpose; the email
          // says what that family's row actually asked for.
          sourceMessageKey: source.messageKey,
        });

        if (email) {
          pendingEmails.push(email);
        }
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            notificationId: source.id,
            notificationType: "notification-follow-up",
          },
        });
      }
    }

    // Per page rather than once at the end, so a run the deadline cuts short
    // still sends what it has already written reminders for. The rows in the
    // page are done with either way: the notifications are committed.
    emailed += await flushFollowUpEmails(pendingEmails);

    const last = page.at(-1);

    if (stopped || !hasMore || !last) {
      break;
    }

    after = { createdAt: last.createdAt, id: last.id };
  }

  return { examined, sent, emailed, reachedEnd: !stopped };
}

export const notificationFollowUpSyncService = {
  sendFollowUps,
};
