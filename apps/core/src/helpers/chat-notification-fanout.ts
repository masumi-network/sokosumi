import * as Sentry from "@sentry/node";
import { NotificationKind } from "@sokosumi/database";

import type { CreateNotificationInput } from "@/helpers/notifications";
import {
  createNotification,
  publishNotificationRow,
  resolveDelivery,
} from "@/helpers/notifications";
import prisma from "@/lib/db/prisma";

export interface FanOutChatNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  recipientUserIds: readonly string[];
  /** Decides which preference row the reader reads this under. */
  messageKey: string;
  /** Sentry tag, so a failed emit names which chat notification it was. */
  notificationType: string;
  /**
   * Count this message onto the reader's unread row for the room, where they
   * have one, instead of writing a row of its own.
   */
  countPerRoom?: boolean;
}

/** How many messages a row is already standing for. */
function countOn(messageParams: string): number {
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
    // A row nobody can read the params of is still a row, and it still stands
    // for the messages that landed on it. One is the answer that undercounts.
    return 1;
  }
}

/**
 * Add this message to the reader's unread row for the room, or write the first.
 *
 * A room the reader is following can carry twenty messages in a minute, and
 * twenty rows would be the notification center and nothing else in it. One row
 * says how many, and it is the row the first message wrote, so the reader's
 * place in the list is the room rather than the message.
 *
 * Read is where a group ends. The next message after the reader has been to
 * the room starts a row of its own, which is what makes the count mean
 * "since you last looked".
 *
 * Deliberately not the append-only write `createNotification` documents. The
 * row's params, its metadata and its place in the feed all move, because the
 * row is about the room over time rather than about one message. Two messages
 * landing at once can both find no row and write one each; the next message
 * counts onto the newer of them, and the reader sees one row too many rather
 * than a lost message.
 */
async function countOntoUnreadRow(input: CreateNotificationInput) {
  const unread = await prisma.notification.findFirst({
    where: {
      userId: input.userId,
      kind: input.kind,
      referenceId: input.referenceId,
      messageKey: input.messageKey,
      isRead: false,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!unread) {
    await createNotification(input);
    return;
  }

  const delivery = await resolveDelivery(input);
  const notification = await prisma.notification.update({
    where: { id: unread.id },
    data: {
      messageParams: JSON.stringify({
        ...input.messageParams,
        count: countOn(unread.messageParams) + 1,
      }),
      metadata:
        input.metadata === undefined || input.metadata === null
          ? null
          : JSON.stringify(input.metadata),
      createdAt: new Date(),
      inApp: delivery.inApp,
    },
  });

  if (delivery.inApp || delivery.osBanner) {
    await publishNotificationRow(notification, delivery);
  }
}

/**
 * The steps every chat notification shares: drop the author, drop the readers
 * who muted the room, and write one notification each.
 *
 * A mention, a direct message and a room message differ only in the message
 * key they carry and the preference row that key maps to. Keeping the fan-out
 * in one place means a fix to the mute rule or the workspace lookup reaches all
 * three, and a fourth chat notification is a message key rather than another
 * copy of this function.
 *
 * One recipient's failure never costs the others theirs, so each write is
 * caught and reported on its own.
 */
export async function fanOutChatNotifications(
  params: FanOutChatNotificationsParams,
): Promise<void> {
  const recipientUserIds = [
    ...new Set(
      params.recipientUserIds.filter(
        (userId) =>
          params.authorUserId === null || userId !== params.authorUserId,
      ),
    ),
  ];

  if (recipientUserIds.length === 0) {
    return;
  }

  const mutedMemberships = await prisma.chatRoomUserMember.findMany({
    where: {
      roomId: params.roomId,
      userId: { in: recipientUserIds },
      mutedAt: { not: null },
    },
    select: { userId: true },
  });
  const mutedUserIds = new Set(
    mutedMemberships.map((membership) => membership.userId),
  );
  const notifyUserIds = recipientUserIds.filter(
    (userId) => !mutedUserIds.has(userId),
  );

  if (notifyUserIds.length === 0) {
    return;
  }

  let workspaceId: string | null = null;
  if (params.organizationId) {
    const workspace = await prisma.workspace.findUnique({
      where: { organizationId: params.organizationId },
      select: { id: true },
    });
    workspaceId = workspace?.id ?? null;
  }

  for (const userId of notifyUserIds) {
    const input: CreateNotificationInput = {
      userId,
      kind: NotificationKind.CHAT,
      referenceId: params.roomId,
      eventId: params.messageId,
      messageKey: params.messageKey,
      messageParams: {
        authorName: params.authorName,
        roomName: params.roomName,
      },
      metadata: {
        messageId: params.messageId,
        workspaceId,
      },
    };

    try {
      if (params.countPerRoom) {
        await countOntoUnreadRow(input);
      } else {
        await createNotification(input);
      }
    } catch (error) {
      Sentry.captureException(error, {
        extra: {
          roomId: params.roomId,
          messageId: params.messageId,
          userId,
          notificationType: params.notificationType,
        },
      });
    }
  }
}
