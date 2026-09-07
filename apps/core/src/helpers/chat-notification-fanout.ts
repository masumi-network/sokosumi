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
  /**
   * The room is a group of people rather than a named channel, so its name is
   * the list of who is in it. The reader is told so, because a bare list of
   * names does not read as somewhere a message was written.
   */
  isGroup?: boolean;
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

/** The message a row was written for, when it recorded one. */
function messageIdOn(metadata: string | null): string | null {
  if (!metadata) {
    return null;
  }

  try {
    const stored: unknown = JSON.parse(metadata);
    const messageId =
      typeof stored === "object" && stored !== null && "messageId" in stored
        ? (stored as { messageId: unknown }).messageId
        : undefined;

    return typeof messageId === "string" ? messageId : null;
  } catch {
    return null;
  }
}

/**
 * How many times a message tries to join a row before it takes one of its own.
 *
 * An attempt loses only to another message counting onto the same row at the
 * same instant, and the next attempt then finds the row the winner just wrote.
 * Three is well past what one room can produce.
 */
const COUNT_ATTEMPTS = 3;

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
 * row is about the room over time rather than about one message. What does not
 * move is whether the reader sees it: a row written while the category was
 * silenced stays silenced and is never counted onto, so turning the category
 * back on cannot hand them what they silenced.
 *
 * The count is read in one statement and written in another, so the write
 * names the count it read and fails rather than overwriting one another
 * message put there in between. A message that loses tries again, and one that
 * keeps losing takes a row of its own rather than being dropped.
 *
 * Two messages can still each find no row and write one each. The next message
 * counts onto the newer of them, so the reader sees one row too many rather
 * than a lost message.
 */
async function countOntoUnreadRow(input: CreateNotificationInput) {
  const delivery = await resolveDelivery(input);

  // Do not add a banner-only message to a row that remains visible in the
  // notification center. A separate hidden row preserves the current choice.
  if (!delivery.inApp) {
    await createNotification(input);
    return;
  }

  for (let attempt = 0; attempt < COUNT_ATTEMPTS; attempt += 1) {
    const unread = await prisma.notification.findFirst({
      where: {
        userId: input.userId,
        kind: input.kind,
        referenceId: input.referenceId,
        messageKey: input.messageKey,
        isRead: false,
        // A silenced row is not one the reader is reading, so not one this
        // message may join.
        inApp: true,
      },
      // `createdAt` alone leaves the pick to chance when two rows share an
      // instant, which the double-write above can produce.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    if (!unread) {
      await createNotification(input);
      return;
    }

    // The same message arriving twice. The row already stands for it, and
    // counting it again would say two messages where there was one.
    if (messageIdOn(unread.metadata) === input.metadata?.messageId) {
      return;
    }

    // Named rather than blind: the row must still hold the count this attempt
    // read, and must still be unread. Either having moved means another
    // message got here first.
    const written = await prisma.notification.updateMany({
      where: {
        id: unread.id,
        messageParams: unread.messageParams,
        isRead: false,
      },
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
      },
    });

    if (written.count === 0) {
      continue;
    }

    if (!delivery.inApp && !delivery.osBanner) {
      return;
    }

    const notification = await prisma.notification.findUnique({
      where: { id: unread.id },
    });

    if (notification) {
      await publishNotificationRow(notification, delivery, false);
    }

    return;
  }

  // Every attempt lost the write. A row of its own says more than silence.
  await createNotification(input);
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
        ...(params.isGroup ? { isGroup: true } : {}),
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
