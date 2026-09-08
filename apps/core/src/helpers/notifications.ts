import * as Sentry from "@sentry/node";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";

import type { NotificationDelivery } from "@/helpers/notification-delivery";
import {
  resolveNotificationDelivery,
  toNotificationCategory,
} from "@/helpers/notification-delivery";
import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@/helpers/notification-feed";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import { publishNotificationEvent } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

export interface CreateNotificationInput {
  userId: string;
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
 * Exported for the chat fan-out, which writes a room's row itself once the
 * reader already has an unread one, and has to ask the same question before it
 * publishes.
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
      return { inApp: true, osBanner: false };
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

    return { inApp: true, osBanner: false };
  }
}

/** What one row stands for: the messages counted onto it, or itself. */
function arrivalsOn(messageParams: string): number {
  try {
    const stored: unknown = JSON.parse(messageParams);
    const count =
      typeof stored === "object" && stored !== null && "count" in stored
        ? (stored as { count: unknown }).count
        : undefined;

    return typeof count === "number" && Number.isInteger(count) && count >= 1
      ? count
      : 1;
  } catch {
    // Params nobody can read still belong to the message that wrote them.
    return 1;
  }
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
): Promise<number | undefined> {
  if (
    notification.kind !== NotificationKind.CHAT ||
    !notification.referenceId ||
    notification.isRead
  ) {
    return undefined;
  }

  try {
    const waiting = await prisma.notification.findMany({
      where: {
        userId: notification.userId,
        kind: NotificationKind.CHAT,
        referenceId: notification.referenceId,
        isRead: false,
      },
      select: { messageParams: true, inApp: true, metadata: true },
    });

    let count = 0;
    for (const row of waiting) {
      if (!row.inApp) {
        const metadata: unknown = row.metadata
          ? JSON.parse(row.metadata)
          : null;
        // Hidden rows can be banner-only or fully silenced. Old rows do not
        // record that choice, so their combined count cannot be recovered.
        if (
          typeof metadata !== "object" ||
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
      count += arrivalsOn(row.messageParams);
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
): Promise<void> {
  try {
    const groupCount = await chatRoomArrivals(notification);

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
        messageParams: JSON.parse(notification.messageParams),
        metadata: notification.metadata
          ? JSON.parse(notification.metadata)
          : null,
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
      await publishNotificationRow(
        notification,
        { inApp: notification.inApp, osBanner: false },
        false,
      );
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
 */
export async function createNotification(
  input: CreateNotificationInput,
  prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<CreateNotificationResult> {
  const prisma = prismaClient;
  const uniqueKey = {
    userId: input.userId,
    kind: input.kind,
    referenceId: input.referenceId,
    eventId: input.eventId,
    messageKey: input.messageKey,
  };

  const delivery = await resolveDelivery(input);
  // Preserve the delivery decision for hidden chat rows. A silenced mention
  // remains stored for idempotency, but a room row can represent its message
  // too. Current preferences cannot tell whether that old mention arrived.
  const metadata =
    input.kind === NotificationKind.CHAT && !delivery.inApp
      ? { ...input.metadata, osBannerEligible: delivery.osBanner }
      : input.metadata;

  try {
    const notification = await prisma.notification.create({
      data: {
        ...uniqueKey,
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
      await publishNotificationRow(notification, delivery);
    }

    return { notification, created: true };
  } catch (error) {
    if (!isPrismaUniqueViolation(error)) {
      throw error;
    }

    const notification = await prisma.notification.findUnique({
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
  const result = await prismaClient.notification.deleteMany({
    where: {
      referenceId: grantId,
      messageKey: VENDOR_GRANT_PENDING_MESSAGE_KEY,
      kind: NotificationKind.SYSTEM,
    },
  });

  return result.count;
}

/**
 * Remove pending coworker-access request notifications for an access row after
 * it is resolved (approved, denied, or granted directly). Idempotent.
 */
export async function deletePendingCoworkerAccessNotifications(
  accessId: string,
  prismaClient: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<number> {
  const result = await prismaClient.notification.deleteMany({
    where: {
      referenceId: accessId,
      messageKey: COWORKER_ACCESS_PENDING_MESSAGE_KEY,
      kind: NotificationKind.SYSTEM,
    },
  });

  return result.count;
}
