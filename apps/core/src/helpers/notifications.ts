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
async function resolveDelivery(
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

async function publishNotificationCreated(
  notification: Notification,
  delivery: NotificationDelivery,
): Promise<void> {
  try {
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

  const delivery = await resolveDelivery(input);

  try {
    const notification = await prisma.notification.create({
      data: {
        ...uniqueKey,
        messageParams: JSON.stringify(input.messageParams),
        metadata:
          input.metadata === undefined || input.metadata === null
            ? null
            : JSON.stringify(input.metadata),
        inApp: delivery.inApp,
      },
    });

    // Nothing to render and nothing to interrupt with: the publish would be an
    // Ably message no client acts on.
    if (delivery.inApp || delivery.osBanner) {
      await publishNotificationCreated(notification, delivery);
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
