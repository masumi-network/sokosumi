import * as Sentry from "@sentry/node";
import { type Notification, NotificationKind } from "@sokosumi/database";
import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  isFollowUpMessageKey,
} from "@sokosumi/utils";
import { HTTPException } from "hono/http-exception";

import {
  hasCalendarWorkspaceAccess,
  lockCalendarWorkspaceMembership,
} from "@/helpers/calendar-membership-fence";
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

async function resolveChatDelivery(
  notification: Notification,
  params: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
): Promise<"message" | "room" | "skip"> {
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
      return "skip";
    }
    throw error;
  }
  if (
    room.userMembers.find((member) => member.userId === notification.userId)
      ?.mutedAt
  ) {
    return "skip";
  }
  const messageId = metadata?.messageId;
  if (typeof messageId !== "string") {
    return "message";
  }
  const message = await prisma.chatRoomMessage.findFirst({
    where: { id: messageId, roomId: notification.referenceId },
    select: { parentMessageId: true, deletedAt: true },
  });
  if (
    message?.parentMessageId &&
    notification.messageKey !== CHAT_MENTION_MESSAGE_KEY
  ) {
    const thread = await prisma.chatRoomThreadReadState.findUnique({
      where: {
        userId_parentMessageId: {
          userId: notification.userId,
          parentMessageId: message.parentMessageId,
        },
      },
      select: { mutedAt: true },
    });
    if (thread?.mutedAt) return "skip";
  }
  if (!message || message.deletedAt) {
    // A counted room row also represents earlier arrivals. Losing its latest
    // message must not discard them, but its preview and message link are stale.
    return notification.messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY &&
      typeof params.count === "number" &&
      Number.isInteger(params.count) &&
      params.count > 1
      ? "room"
      : "skip";
  }
  return "message";
}

/** Replays the current committed revision. Failed attempts keep the queued row. */
/**
 * Ends a revision the source it points at no longer supports.
 *
 * A follow-up reminder reserves one shared event id per room and day by being
 * written, so a reminder about a message that has since gone holds the room's
 * reminder for the rest of that day. It gives the reservation back instead, and
 * the next sync run writes a reminder for a message that is still there.
 *
 * A reminder whose email has left keeps its reservation. The email cannot be
 * taken back, and a second reservation would send a second one.
 */
async function releaseRevision(
  notification: Notification,
  publishId: string,
): Promise<void> {
  if (
    isFollowUpMessageKey(notification.messageKey) &&
    notification.emailId === null
  ) {
    await prisma.notification.deleteMany({
      where: { id: notification.id, publishId },
    });
    return;
  }

  await clearRevision(notification.id, publishId);
}

/**
 * A Workspace row is only ever published to a current member. `createNotification`
 * checks this when it owns the write transaction, but a publish runs after that
 * transaction commits, so the membership can be gone by the time it goes out.
 */
async function hasWorkspaceAccess(
  notification: Notification,
): Promise<boolean> {
  if (!notification.workspaceId) {
    return true;
  }
  const workspaceId = notification.workspaceId;
  return prisma.$transaction(async (tx) => {
    await lockCalendarWorkspaceMembership(tx, workspaceId);
    return hasCalendarWorkspaceAccess(tx, workspaceId, notification.userId);
  });
}

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
    const chatDelivery =
      user && notification.kind === NotificationKind.CHAT
        ? await resolveChatDelivery(notification, params, metadata)
        : "message";
    if (!user) {
      await clearRevision(notificationId, publishId);
      return "skipped";
    }
    if (chatDelivery === "skip") {
      await releaseRevision(notification, publishId);
      return "skipped";
    }
    if (!(await hasWorkspaceAccess(notification))) {
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
    if (chatDelivery === "room") {
      const {
        authorName: _author,
        messagePreview: _preview,
        ...roomParams
      } = params;
      const { messageId: _message, ...roomMetadata } = metadata ?? {};
      latest.messageParams = JSON.stringify(roomParams);
      latest.metadata = JSON.stringify(roomMetadata);
    }
    const published = await publishNotificationRow(
      { ...latest, inApp: delivery.inApp },
      delivery,
      latest.publishCreated === true && !latest.isRead,
      prisma,
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
