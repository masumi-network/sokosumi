import * as Sentry from "@sentry/node";
import type { Prisma } from "@sokosumi/database";

import {
  FOLLOW_UP_SOURCE_MESSAGE_KEYS,
  followUpEventId,
  followUpMessageKeyFor,
} from "@/helpers/notification-follow-up";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import type { CreateNotificationInput } from "@/helpers/notifications";
import { createNotification, resolveDelivery } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

/** How long a notification waits on the reader before it is said again. */
export const NOTIFICATION_FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;

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
export const NOTIFICATION_FOLLOW_UP_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * How many notifications one read returns.
 *
 * A page, not a cap on the run. The run walks every eligible row, oldest
 * first, and stops on the handler's deadline rather than on a row count.
 * A fixed cap would be a silent loss instead: the window moves with the clock,
 * so a row left above the cap is out of range by the next run and never gets
 * its reminder.
 *
 * Sized to keep one read and the writes that follow it short, so the deadline
 * lands between pages rather than deep inside one.
 */
export const NOTIFICATION_FOLLOW_UP_PAGE_SIZE = 500;

export interface SendFollowUpsOptions {
  now?: Date;
  /** When already aborted (sync deadline), read nothing and write nothing. */
  abortSignal?: AbortSignal;
  /** Asked before each write, so a run stops on the handler's deadline. */
  shouldContinue?: () => boolean;
}

export interface SendFollowUpsResult {
  /** Notifications this run looked at. */
  examined: number;
  /** Follow-ups this run actually wrote. */
  sent: number;
}

/**
 * The columns a follow-up is built from.
 *
 * Named once and used as the query's `select`, so the read asks for exactly
 * what is read and Prisma types the result from the same list. The interface
 * and the read cannot then drift apart, and neither can drift from the schema
 * without a type error.
 */
const FOLLOW_UP_SOURCE_COLUMNS = {
  id: true,
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

/**
 * The follow-up this notification would be, or null when it is not one to send.
 *
 * A source key with no mapping is skipped rather than guessed at. The query
 * already asks only for mapped keys, so this answers for the type rather than
 * for anything that path produces.
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
  // destination. A column that will not read leaves the reminder without it
  // rather than costing the reader the reminder.
  const messageParams =
    readNotificationRowJson(source.messageParams, source.id, "messageParams") ??
    {};
  const metadata = source.metadata
    ? readNotificationRowJson(source.metadata, source.id, "metadata")
    : null;

  return {
    userId: source.userId,
    kind: source.kind,
    referenceId: source.referenceId,
    eventId: followUpEventId(source.id),
    messageKey,
    messageParams,
    metadata,
  };
}

/**
 * Say once more what nobody opened (SOK-916).
 *
 * A notification that waits on the reader and is still unread a day later gets
 * exactly one follow-up. Unread is the whole of the signal: opening the room,
 * the notification, the task or the job all mark it read, so a row still unread
 * is one nothing has happened to.
 *
 * Only rows that were delivered in the app are eligible. A notification the
 * reader's preferences silenced was stored with that decision on it, and
 * reminding someone of what they switched off would be the feature working
 * against them.
 *
 * One follow-up, ever. The event id is derived from the original, so the
 * uniqueness the notification table already enforces is what stops the second,
 * and this needs no record of its own that a run happened.
 *
 * A write that throws costs that one reminder and nothing else. The run carries
 * on, and the next hour finds the row again inside the window.
 */
export async function sendFollowUps(
  options: SendFollowUpsOptions = {},
): Promise<SendFollowUpsResult> {
  if (options.abortSignal?.aborted) {
    return { examined: 0, sent: 0 };
  }

  const now = options.now ?? new Date();
  const waitedUntil = new Date(now.getTime() - NOTIFICATION_FOLLOW_UP_DELAY_MS);

  let examined = 0;
  let sent = 0;
  let cursor: string | undefined;
  let stopped = false;

  while (!stopped) {
    if (options.abortSignal?.aborted || options.shouldContinue?.() === false) {
      break;
    }

    const sources = await prisma.notification.findMany({
      select: FOLLOW_UP_SOURCE_COLUMNS,
      where: {
        isRead: false,
        inApp: true,
        messageKey: { in: [...FOLLOW_UP_SOURCE_MESSAGE_KEYS] },
        createdAt: {
          gt: new Date(
            waitedUntil.getTime() - NOTIFICATION_FOLLOW_UP_WINDOW_MS,
          ),
          lte: waitedUntil,
        },
      },
      // `createdAt` alone leaves the order of two rows in the same instant to
      // chance, and the cursor below would then skip or repeat them.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: NOTIFICATION_FOLLOW_UP_PAGE_SIZE,
      // A follow-up leaves its source row unread, so the next page cannot be
      // "whatever still matches". It has to continue from where this one ended.
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });

    if (sources.length === 0) {
      break;
    }

    for (const source of sources) {
      if (
        options.abortSignal?.aborted ||
        options.shouldContinue?.() === false
      ) {
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
        const delivery = await resolveDelivery(input);

        // Asked again. The read above is itself an await, so it can be the
        // thing that crosses the deadline, and the check at the top of the
        // loop answered for a moment that has passed.
        if (
          options.abortSignal?.aborted ||
          options.shouldContinue?.() === false
        ) {
          stopped = true;
          break;
        }

        if (!delivery.inApp && !delivery.osBanner) {
          continue;
        }

        // The answer above, not a second read. Between two reads the reader
        // can switch the category off, and the write would then store a row
        // nobody sees while this run counted a reminder as sent.
        const { created } = await createNotification(input, prisma, delivery);

        if (created) {
          sent += 1;
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

    if (sources.length < NOTIFICATION_FOLLOW_UP_PAGE_SIZE) {
      break;
    }

    cursor = sources[sources.length - 1].id;
  }

  return { examined, sent };
}

export const notificationFollowUpSyncService = {
  sendFollowUps,
};
