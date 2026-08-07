import * as Sentry from "@sentry/node";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";

import { VENDOR_GRANT_PENDING_MESSAGE_KEY } from "@/helpers/notification-feed";
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

async function publishNotificationCreated(
  notification: Notification,
): Promise<void> {
  try {
    await publishNotificationEvent({
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
