import * as Sentry from "@sentry/node";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";

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
 * Whether this notification also goes out as a closed-app OS banner.
 *
 * Push rides the notification publish over Ably (ADR-0022), gated on explicit
 * user consent. This slice pushes chat only; widening the kinds is a change to
 * this gate alone (SOK-877). Non-chat kinds skip the user read entirely, so the
 * bulk job and task paths keep their current query count. Chat pays one read
 * per notification, so a room mention costs one per recipient.
 *
 * Never throws, and never reads through the caller's transaction client. A
 * consent read that fails must degrade push alone: it must not abort a caller's
 * transaction, and it must not stop the in-app realtime publish.
 */
async function shouldPushNotification(
  notification: Notification,
): Promise<boolean> {
  if (notification.kind !== NotificationKind.CHAT) {
    return false;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: notification.userId },
      select: { pushOptIn: true },
    });

    return user?.pushOptIn === true;
  } catch (error) {
    console.error("Failed to read the push opt-in; skipping push:", error);
    Sentry.captureException(error, {
      extra: {
        notificationId: notification.id,
        userId: notification.userId,
        errorType: "push-opt-in-read",
      },
    });

    return false;
  }
}

async function publishNotificationCreated(
  notification: Notification,
): Promise<void> {
  try {
    const push = await shouldPushNotification(notification);

    await publishNotificationEvent({
      push,
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

  try {
    const notification = await prisma.notification.create({
      data: {
        ...uniqueKey,
        messageParams: JSON.stringify(input.messageParams),
        metadata:
          input.metadata === undefined || input.metadata === null
            ? null
            : JSON.stringify(input.metadata),
      },
    });

    await publishNotificationCreated(notification);

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
