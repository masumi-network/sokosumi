import * as Sentry from "@sentry/node";
import { type Notification, NotificationKind } from "@sokosumi/database";
import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import {
  resolveNotificationDelivery,
  toNotificationCategory,
} from "@/helpers/notification-delivery";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import { publishNotificationRow } from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";
import { requireChatRoomUserAccess } from "@/routes/v1/chats/rooms/helpers";

export const NOTIFICATION_PUBLISH_WINDOW_MS = 15 * 60 * 1000;
const NOTIFICATION_PUBLISH_RETRY_MS = 60 * 1000;

const CLEARED_PUBLISH_FIELDS = {
  publishId: null,
  publishPush: null,
  publishCreated: null,
  publishQueuedAt: null,
  publishNextAttemptAt: null,
};

type PublishOutcome = "published" | "skipped" | "pending";

async function clearRevision(id: string, publishId: string) {
  await prisma.notification.updateMany({
    where: { id, publishId },
    data: CLEARED_PUBLISH_FIELDS,
  });
}

async function canReceiveChat(
  notification: Notification,
  metadata: Record<string, unknown> | null,
): Promise<boolean> {
  let room: Awaited<ReturnType<typeof requireChatRoomUserAccess>>;
  try {
    room = await requireChatRoomUserAccess(
      notification.referenceId,
      notification.userId,
      prisma,
    );
  } catch (error) {
    if (
      error instanceof HTTPException &&
      (error.status === 403 || error.status === 404)
    ) {
      return false;
    }
    throw error;
  }
  if (
    room.userMembers.find((member) => member.userId === notification.userId)
      ?.mutedAt
  ) {
    return false;
  }
  const messageId = metadata?.messageId;
  if (typeof messageId !== "string") {
    return true;
  }
  const message = await prisma.chatRoomMessage.findFirst({
    where: { id: messageId, roomId: notification.referenceId, deletedAt: null },
    select: { parentMessageId: true },
  });
  if (!message) {
    return false;
  }
  if (
    !message.parentMessageId ||
    notification.messageKey === CHAT_MENTION_MESSAGE_KEY
  ) {
    return true;
  }
  const thread = await prisma.chatRoomThreadReadState.findUnique({
    where: {
      userId_parentMessageId: {
        userId: notification.userId,
        parentMessageId: message.parentMessageId,
      },
    },
    select: { mutedAt: true },
  });
  return !thread?.mutedAt;
}

/** Replays the current committed revision. Failed attempts keep the queued row. */
export async function dispatchNotificationPublish(
  notificationId: string,
  now = new Date(),
): Promise<PublishOutcome> {
  try {
    const pending = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    // The writer can still be inside a transaction. The cron reads it after commit.
    if (
      !pending?.publishId ||
      !pending.publishQueuedAt ||
      !pending.publishNextAttemptAt
    ) {
      return "pending";
    }
    const publishId = pending.publishId;
    if (
      now.getTime() - pending.publishQueuedAt.getTime() >=
      NOTIFICATION_PUBLISH_WINDOW_MS
    ) {
      await clearRevision(notificationId, publishId);
      return "skipped";
    }
    if (pending.publishNextAttemptAt > now) {
      return "pending";
    }
    const claim = await prisma.notification.updateMany({
      where: {
        id: notificationId,
        publishId,
        publishNextAttemptAt: { lte: now },
      },
      data: {
        publishNextAttemptAt: new Date(
          now.getTime() + NOTIFICATION_PUBLISH_RETRY_MS,
        ),
      },
    });
    if (claim.count === 0) {
      return "pending";
    }
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification || notification.publishId !== publishId) {
      return "pending";
    }
    const params = readNotificationRowJson(
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
    if (
      params === null ||
      (notification.metadata !== null && metadata === null)
    ) {
      await clearRevision(notificationId, publishId);
      return "skipped";
    }
    const user = await prisma.user.findUnique({
      where: { id: notification.userId },
      select: {
        pushOptIn: true,
        notificationPreferences: {
          select: { category: true, channel: true, enabled: true },
        },
      },
    });
    if (
      !user ||
      (notification.kind === NotificationKind.CHAT &&
        !(await canReceiveChat(notification, metadata)))
    ) {
      await clearRevision(notificationId, publishId);
      return "skipped";
    }
    const delivery = resolveNotificationDelivery({
      category: toNotificationCategory(
        notification.kind,
        notification.messageKey,
      ),
      preferences: user.notificationPreferences,
      pushOptIn: user.pushOptIn,
    });
    delivery.email = false;
    delivery.inApp = notification.inApp && delivery.inApp;
    delivery.osBanner =
      notification.publishPush !== false &&
      delivery.osBanner &&
      !notification.isRead;
    if (!delivery.inApp && !delivery.osBanner) {
      await clearRevision(notificationId, publishId);
      return "skipped";
    }
    // Recheck after access/preferences reads so a concurrent arrival or read wins.
    const latest = await prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!latest || latest.publishId !== publishId) {
      return "pending";
    }
    if (latest.isRead) {
      delivery.osBanner = false;
    }
    const published = await publishNotificationRow(
      { ...latest, inApp: delivery.inApp },
      delivery,
      latest.publishCreated === true && !latest.isRead,
      publishId,
    );
    if (!published) {
      return "pending";
    }
    await clearRevision(notificationId, publishId);
    return "published";
  } catch (error) {
    Sentry.captureException(error, {
      extra: { notificationId, errorType: "notification-publish-retry" },
    });
    return "pending";
  }
}
