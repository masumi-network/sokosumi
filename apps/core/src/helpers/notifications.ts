import * as Sentry from "@sentry/node";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";
import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  isFollowUpMessageKey,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@sokosumi/utils";
import { waitUntil } from "@vercel/functions";

import {
  hasCalendarWorkspaceAccess,
  lockCalendarWorkspaceMembership,
} from "@/helpers/calendar-membership-fence";
import type { NotificationDelivery } from "@/helpers/notification-delivery";
import {
  resolveNotificationDelivery,
  toNotificationCategory,
} from "@/helpers/notification-delivery";
import {
  cancelNotificationEmails,
  dispatchNotificationEmail,
  EMAILED_NOTIFICATION_COLUMNS,
} from "@/helpers/notification-email-dispatch";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { publishNotificationEvent } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

export interface CreateNotificationInput {
  userId: string;
  workspaceId?: string;
  kind: NotificationKind;
  referenceId: string;
  eventId: string;
  messageKey: string;
  messageParams: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
}

export interface CreateNotificationResult {
  notification: Notification;
  created: boolean;
}

/**
 * Where this notification goes: the app, the OS banner, both, or neither.
 *
 * Exported for the two callers that have to ask before they write. The chat
 * fan-out writes a room's row itself once the reader already has an unread
 * one, and asks the same question before it publishes. The follow-up sync asks
 * so it can skip a silenced reader rather than store a row nobody sees, and
 * hands the answer back through `deliveryOverride` below.
 *
 * Read once, before the row is written, because the in-app answer is stored on
 * the row itself. That costs one read per notification on the bulk job and task
 * paths too, and one read per recipient of a room mention.
 *
 * Never throws, and never reads through the caller's transaction client. A
 * failed read must degrade delivery alone: it must not abort a caller's
 * transaction, and it must not cost the reader the notification. So it falls
 * back to the in-app notification without the banner, which is the quieter of
 * the two and the one that leaves a record the reader can still find.
 */
export async function resolveDelivery(
  input: CreateNotificationInput,
): Promise<NotificationDelivery> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        pushOptIn: true,
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
      },
    });

    if (!user) {
      return { inApp: true, osBanner: false, email: false };
    }

    return resolveNotificationDelivery({
      category: toNotificationCategory(input.kind, input.messageKey),
      preferences: user.notificationPreferences,
      pushOptIn: user.pushOptIn,
    });
  } catch (error) {
    console.error(
      "Failed to read the notification preferences; skipping push:",
      error,
    );
    Sentry.captureException(error, {
      extra: {
        userId: input.userId,
        kind: input.kind,
        messageKey: input.messageKey,
        errorType: "notification-delivery-read",
      },
    });

    return { inApp: true, osBanner: false, email: false, fellBack: true };
  }
}

/** What one row stands for: the messages counted onto it, or itself. */
function arrivalsOn(row: { id: string; messageParams: string }): number {
  // Params nobody can read still belong to the message that wrote them, so
  // the banner keeps the row and undercounts it by however many were counted
  // onto it. Read through the reporting reader: this is the second place the
  // same damage is answered from, and it was the silent one.
  const stored = readNotificationRowJson(
    row.messageParams,
    row.id,
    "messageParams",
  );
  const count = stored && "count" in stored ? stored.count : undefined;

  return typeof count === "number" && Number.isInteger(count) && count >= 1
    ? count
    : 1;
}

/**
 * How many messages are waiting for this reader in this room.
 *
 * A chat banner holds the whole room and each arrival replaces the one
 * standing, so the banner has to say how many it stands for. The push service
 * worker can query nothing (ADR-0023), so the number travels with the payload
 * rather than being worked out where it is shown.
 *
 * Summed over the rows rather than counted: a room's messages are counted onto
 * one row, so counting rows would read four messages and a mention as two.
 *
 * Undefined for everything else. A job and a task each happened once, and a
 * row published because it went read is taking a banner down rather than
 * raising one, so a count of what is still waiting would belong to no banner.
 *
 * Never throws. The interruption matters more than the number on it, so a
 * failed count costs the banner its count and nothing else.
 */
async function chatRoomArrivals(
  notification: Notification,
  client: Prisma.TransactionClient | typeof prisma,
): Promise<number | undefined> {
  if (
    notification.kind !== NotificationKind.CHAT ||
    !notification.referenceId ||
    notification.isRead
  ) {
    return undefined;
  }

  try {
    const waiting = await client.notification.findMany({
      where: {
        userId: notification.userId,
        kind: NotificationKind.CHAT,
        referenceId: notification.referenceId,
        isRead: false,
      },
      select: {
        id: true,
        messageKey: true,
        messageParams: true,
        inApp: true,
        metadata: true,
      },
    });

    let count = 0;
    for (const row of waiting) {
      // Reminders refer to existing messages, so they add no arrivals.
      if (isFollowUpMessageKey(row.messageKey)) {
        continue;
      }
      if (!row.inApp) {
        // Read the same way as the count below it. Parsed here, a column
        // that will not read threw out of the loop into the catch, which
        // reports on every publish of every message and never says which row
        // it was. The answer is unchanged: a hidden row that cannot say
        // whether it was banner-only takes the count down with it either way.
        const metadata =
          row.metadata !== null
            ? readNotificationRowJson(row.metadata, row.id, "metadata")
            : null;
        // Hidden rows can be banner-only or fully silenced. Old rows do not
        // record that choice, so their combined count cannot be recovered.
        if (
          metadata === null ||
          !("osBannerEligible" in metadata) ||
          typeof metadata.osBannerEligible !== "boolean"
        ) {
          return undefined;
        }
        if (!metadata.osBannerEligible) {
          continue;
        }
      }
      count += arrivalsOn(row);
    }
    return count > 0 ? count : undefined;
  } catch (error) {
    console.error("Failed to count the room's unread notifications:", error);
    Sentry.captureException(error, {
      extra: {
        userId: notification.userId,
        referenceId: notification.referenceId,
        errorType: "chat-room-arrival-count",
      },
    });

    return undefined;
  }
}

/**
 * Tell the reader's open tabs about a row, and raise the OS banner.
 *
 * Named for the row rather than for the insert: the chat fan-out publishes a
 * row it has just counted a message onto, and an open tab replaces the one it
 * is holding by id.
 */
export async function publishNotificationRow(
  notification: Notification,
  delivery: NotificationDelivery,
  /**
   * False when the row was already there and this publish only changes it.
   * A reader's open tab counts an unread row it has never seen towards the
   * badge, which is right for a row that has just been written and one too
   * many for a row the badge already counted.
   */
  created = true,
  prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  try {
    // Read the same way the count reads them, rather than with a bare
    // `JSON.parse`. A damaged column threw out of here into the catch below,
    // which reports an event that names the publish rather than the column,
    // says nothing about which of the two would not read, and is written
    // again on every publish of that row. The count had already named the row
    // by then, so one damaged column filed two events and went on filing one
    // of them for ever.
    const messageParams = readNotificationRowJson(
      notification.messageParams,
      notification.id,
      "messageParams",
    );
    const metadata =
      notification.metadata !== null
        ? readNotificationRowJson(
            notification.metadata,
            notification.id,
            "metadata",
          )
        : null;

    // Nothing is published for a row whose columns will not read, which is
    // what the throw did. A tab holding this row keeps what it has, and the
    // row has been named once rather than on every publish. A row that
    // carries no metadata at all is not that case and publishes as before.
    if (
      messageParams === null ||
      (notification.metadata !== null && metadata === null)
    ) {
      return;
    }

    const groupCount = await chatRoomArrivals(notification, prismaClient);

    await publishNotificationEvent({
      push: delivery.osBanner,
      userId: notification.userId,
      notification: {
        id: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        referenceId: notification.referenceId,
        eventId: notification.eventId,
        messageKey: notification.messageKey,
        messageParams,
        metadata,
        isRead: notification.isRead,
        readAt: notification.readAt?.toISOString() ?? null,
        createdAt: notification.createdAt.toISOString(),
        inApp: notification.inApp,
        osBanner: delivery.osBanner,
        created,
        ...(groupCount !== undefined && { groupCount }),
      },
    });
  } catch (error) {
    console.error("Failed to publish notification over Ably:", error);
    Sentry.captureException(error, {
      extra: {
        notificationId: notification.id,
        userId: notification.userId,
        kind: notification.kind,
        errorType: "ably-publish-notification",
      },
    });
  }
}

/**
 * Publish a scoped row only while its recipient still has Workspace access.
 * The membership lock is shared with deletion, so a revoke cannot commit
 * between the access check and the user-channel publish.
 */
export async function publishScopedNotificationRow(
  notificationId: string,
  workspaceId: string,
  userId: string,
  delivery: NotificationDelivery,
  created = true,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await lockCalendarWorkspaceMembership(tx, workspaceId);
      const hasAccess = await hasCalendarWorkspaceAccess(
        tx,
        workspaceId,
        userId,
      );
      const notification = await tx.notification.findUnique({
        where: { id: notificationId },
      });
      if (!hasAccess || !notification) {
        return;
      }

      await publishNotificationRow(notification, delivery, created, tx);
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        notificationId,
        userId,
        workspaceId,
        errorType: "scoped-notification-publish",
      },
    });
  }
}

/**
 * Tell the reader's open tabs that these rows are read.
 *
 * The row is published rather than a bare id, because a tab holding it
 * replaces what it holds and a tab that never loaded it can tell a row it
 * already counted from a new one. Rows the app never shows are published too
 * and dropped by the reader, which is cheaper than asking here which surface
 * each one belongs to.
 *
 * This is how a banner learns it is stale. A chat banner stands for a room,
 * and the reader can finish with that room by opening it, by reading it on
 * another device, or by marking its row read in the Notification Center; the
 * cleared row is the one word every open tab gets in all three cases.
 *
 * Never throws, and meant for `waitUntil`: the reader has already been
 * answered by the time it runs, so a failure must not reject behind them. The
 * rows come back on the next fetch, so the cost of losing it is a bell that
 * lags until then and a banner that stands until the reader dismisses it.
 *
 * Each row is published to the reader named on it, so the caller owns the
 * scoping: pass ids it has already established belong to the reader it
 * answered.
 */
export async function publishClearedNotifications(
  ids: string[],
): Promise<void> {
  if (ids.length === 0) {
    return;
  }

  try {
    const cleared = await prisma.notification.findMany({
      where: { id: { in: ids } },
    });

    for (const notification of cleared) {
      // No banner: nothing arrived. This says one stopped waiting.
      // No email. This says an existing row again over realtime; the
      // email, if there was one, went out when the row was written.
      const delivery = {
        inApp: notification.inApp,
        osBanner: false,
        email: false,
      };
      if (notification.workspaceId) {
        await publishScopedNotificationRow(
          notification.id,
          notification.workspaceId,
          notification.userId,
          delivery,
          false,
        );
      } else {
        await publishNotificationRow(notification, delivery, false);
      }
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        notificationIds: ids,
        errorType: "publish-cleared-notifications",
      },
    });
  }
}

/**
 * Internal helper to create an append-only notification feed item.
 *
 * eventId references a jobEvent or taskEvent row depending on kind.
 *
 * Duplicate emits for the same
 * (userId, kind, referenceId, eventId, messageKey) are idempotent no-ops.
 * Existing content, metadata, read state, and feed position must not change
 * after insert.
 *
 * This is an internal-only helper for Core services to emit notifications.
 * Not exposed as a public API in v1.
 *
 * `deliveryOverride` is for a caller that already asked. The follow-up sync
 * reads the answer itself, to skip a reminder nobody would see before it
 * writes one, and passing that answer here stores the row under the decision
 * the caller acted on. Resolving a second time would let preferences change
 * between the two reads and store a hidden row the caller counted as sent.
 *
 * Pass only an answer that came from `resolveDelivery`. It carries the push
 * opt-in and the reader's per-category choices, and nothing here checks them
 * again: a hand-built value would push to a reader who switched push off.
 */
export async function createNotification(
  input: CreateNotificationInput,
  prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
  deliveryOverride?: NotificationDelivery,
): Promise<CreateNotificationResult> {
  const client = prismaClient;
  const uniqueKey = {
    userId: input.userId,
    kind: input.kind,
    referenceId: input.referenceId,
    eventId: input.eventId,
    messageKey: input.messageKey,
  };

  const delivery = deliveryOverride ?? (await resolveDelivery(input));
  // Preserve the delivery decision for hidden chat rows. A silenced mention
  // remains stored for idempotency, but a room row can represent its message
  // too. Current preferences cannot tell whether that old mention arrived.
  const metadata =
    input.kind === NotificationKind.CHAT && !delivery.inApp
      ? { ...input.metadata, osBannerEligible: delivery.osBanner }
      : input.metadata;

  const callerOwnsTransaction = prismaClient !== prisma;

  if (input.workspaceId && callerOwnsTransaction) {
    await lockCalendarWorkspaceMembership(client, input.workspaceId);
    if (
      !(await hasCalendarWorkspaceAccess(
        client,
        input.workspaceId,
        input.userId,
      ))
    ) {
      throw new Error("Notification recipient no longer has Workspace access");
    }
  }

  try {
    const notification = await client.notification.create({
      data: {
        ...uniqueKey,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        messageParams: JSON.stringify(input.messageParams),
        metadata:
          metadata === undefined || metadata === null
            ? null
            : JSON.stringify(metadata),
        inApp: delivery.inApp,
      },
    });

    // Nothing to render and nothing to interrupt with: the publish would be an
    // Ably message no client acts on.
    if (delivery.inApp || delivery.osBanner) {
      if (input.workspaceId && !callerOwnsTransaction) {
        await publishScopedNotificationRow(
          notification.id,
          input.workspaceId,
          input.userId,
          delivery,
        );
      } else {
        await publishNotificationRow(
          notification,
          delivery,
          true,
          callerOwnsTransaction ? client : prisma,
        );
      }
    }

    // Scheduled rather than awaited: the write may be inside the caller's
    // transaction, and the email waits for it to commit (SOK-1090).
    if (delivery.email) {
      waitUntil(dispatchNotificationEmail(notification));
    }

    return { notification, created: true };
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }

    const notification = await client.notification.findUnique({
      where: {
        userId_kind_referenceId_eventId_messageKey: uniqueKey,
      },
    });

    if (!notification) {
      throw error;
    }

    return { notification, created: false };
  }
}

/**
 * Remove pending vendor-grant request notifications for a grant after it is
 * resolved (approved, denied, or granted directly). Idempotent.
 */
export async function deletePendingVendorGrantNotifications(
  grantId: string,
  prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return deletePendingRequestNotifications(
    { referenceId: grantId, messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY },
    prismaClient,
  );
}

/**
 * Remove pending coworker-access request notifications for an access row after
 * it is resolved (approved, denied, or granted directly). Idempotent.
 */
export async function deletePendingCoworkerAccessNotifications(
  accessId: string,
  prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  return deletePendingRequestNotifications(
    { referenceId: accessId, messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY },
    prismaClient,
  );
}

/**
 * The shared delete, which also takes back the emails scheduled for the rows.
 *
 * Read before the delete, because after it there is nothing left to name.
 * The cancel is scheduled from inside the caller's transaction, so a
 * transaction that rolls back after this has cancelled the email for a row
 * that is still there. That reader gets no email about the request and the
 * row stays unread, which the follow-up sync reminds them of a day later.
 */
async function deletePendingRequestNotifications(
  request: { referenceId: string; messageKey: string },
  prismaClient: Prisma.TransactionClient | typeof prisma,
): Promise<number> {
  const where = { ...request, kind: NotificationKind.SYSTEM };

  // Takes the rows' locks before they are read. The dispatcher writes a
  // row's email onto it with an `isRead: false` of its own, so without this
  // it can land between the read and the delete: the read would miss the
  // email, and the delete would take the row it is named on, leaving nothing
  // to cancel it by. Locked first, the dispatcher either wrote before this,
  // and the read sees its email, or waits for the delete and writes nothing.
  // Whether it sends at all by then is its own question, answered at
  // `dispatchNotificationEmail`.
  await prismaClient.notification.updateMany({ where, data: { isRead: true } });

  const scheduled = await prismaClient.notification.findMany({
    where: { ...where, emailScheduledAt: { not: null } },
    select: EMAILED_NOTIFICATION_COLUMNS,
  });
  const result = await prismaClient.notification.deleteMany({ where });

  waitUntil(cancelNotificationEmails(scheduled));

  return result.count;
}
