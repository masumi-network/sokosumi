import * as Sentry from "@sentry/node";
import { NotificationKind, type Prisma } from "@sokosumi/database";
import { buildChatMessagePreview } from "@sokosumi/utils";

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
  /** The room message body, which the reader is shown a preview of. */
  content: string;
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

  // This runs after the response, so a reader can delete the message before
  // it lands. The delete takes the text off the rows that exist by then, and
  // writing the preview now would put it back with nothing left to take it
  // off again. Read by primary key, next to the reads above.
  const message = await prisma.chatRoomMessage.findUnique({
    where: { id: params.messageId },
    select: { deletedAt: true },
  });

  // Built once rather than per reader: every recipient of one message is shown
  // the same preview, and the rule reads the whole body to get there.
  const messagePreview =
    message === null || message.deletedAt !== null
      ? ""
      : buildChatMessagePreview(params.content);

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
        // Omitted rather than empty when the body cleans to nothing. A reader
        // is then shown the line that names the author and the room, which is
        // what a banner said before there was a preview at all.
        ...(messagePreview ? { messagePreview } : {}),
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

  if (!messagePreview) {
    return;
  }

  // The read above is one moment and the loop is another. A delete or an edit
  // landing between them takes the text off the rows that exist by then and
  // leaves it on every row written after. This fan-out is the last writer of
  // those rows, so it is the one that has to look again.
  const current = await prisma.chatRoomMessage.findUnique({
    where: { id: params.messageId },
    select: { content: true, deletedAt: true },
  });
  const saysNow =
    current === null || current.deletedAt !== null ? "" : current.content;

  if (saysNow === params.content) {
    return;
  }

  await rewriteChatNotificationPreviews({
    roomId: params.roomId,
    messageId: params.messageId,
  });
}

/** A row's stored params, or null when the row cannot be read. */
function paramsOn(messageParams: string): Record<string, unknown> | null {
  try {
    const stored: unknown = JSON.parse(messageParams);

    return typeof stored === "object" && stored !== null
      ? (stored as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * How many times one row is read again after losing its guarded write.
 *
 * A write loses to another writer landing on the same row between the read
 * and the write: another message counting onto it, or the other of an edit
 * and a delete of this same message. The next attempt reads what the winner
 * wrote and decides on that. Three is well past what one room can produce,
 * and matches the bound the counting path uses.
 */
const REWRITE_ATTEMPTS = 3;

/** A notification row, as much of it as a rewrite reads. */
interface RewritableRow {
  id: string;
  messageParams: string;
  metadata: string | null;
}

/**
 * Put this message's preview on one row, or take it off.
 *
 * The write names the params it read, so it lands only while the row still
 * carries what this rewrite decided about. Losing that race is not a failure:
 * the row moved, so read it again and decide on what it says now. Giving up
 * instead would leave a deleted message's text on the row whenever an edit of
 * the same message wrote between this rewrite's read and its write.
 */
async function rewriteRow(
  row: RewritableRow,
  messageId: string,
  preview: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  let current = row;

  for (let attempt = 0; attempt < REWRITE_ATTEMPTS; attempt += 1) {
    if (messageIdOn(current.metadata) !== messageId) {
      return;
    }

    // One unreadable row must not cost every other recipient their wipe, the
    // same way `countOn` and `messageIdOn` read a row above. A row carrying
    // no preview is left alone: this takes text back or brings it up to date,
    // and never puts text somewhere it was not.
    const stored = paramsOn(current.messageParams);
    if (typeof stored?.messagePreview !== "string") {
      return;
    }

    const { messagePreview: _previous, ...rest } = stored;
    const written = await tx.notification.updateMany({
      where: { id: current.id, messageParams: current.messageParams },
      data: {
        messageParams: JSON.stringify(
          preview ? { ...rest, messagePreview: preview } : rest,
        ),
      },
    });

    if (written.count > 0) {
      return;
    }

    const reread = await tx.notification.findUnique({
      where: { id: current.id },
      select: { id: true, messageParams: true, metadata: true },
    });

    if (reread === null) {
      return;
    }

    current = reread;
  }
}

/**
 * Bring the copy of a message that rides its notifications up to date.
 *
 * A deleted message is wiped from its own row, and an edited one keeps only
 * what it now says. The copy on a notification row would otherwise outlive
 * both: it stays readable through the notifications API long after the
 * message stopped saying it. Read the current body under a row lock so a
 * delayed edit cannot replace a newer preview with its old request body.
 *
 * A preview is never added to a row that had none. The reader was already
 * sent whatever the row holds, so this takes text back or brings it up to
 * date, and never puts text somewhere it was not.
 *
 * Failure is reported rather than thrown: a reader deleting a message must
 * not be told the delete failed because a copy of it survived.
 */
export async function rewriteChatNotificationPreviews(params: {
  roomId: string;
  messageId: string;
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      // Hold the message lock until its copies are updated. Message edits and
      // deletes use this same row, so the preview follows their commit order.
      await tx.$queryRaw`
        SELECT "id" FROM "chat_room_message"
        WHERE "id" = ${params.messageId}::uuid
          AND "roomId" = ${params.roomId}::uuid
        FOR UPDATE
      `;
      const message = await tx.chatRoomMessage.findUnique({
        where: { id: params.messageId, roomId: params.roomId },
        select: { content: true, deletedAt: true },
      });

      // `metadata` is stored as JSON text, so the message is matched as text
      // and the match confirmed by parsing below. Scoped to the room's own chat
      // rows, and run only when a reader deletes or edits, which is rare beside
      // posting. A counted row names the last message counted onto it, which is
      // why the id is read from `metadata` rather than from `eventId`.
      const rows = await tx.notification.findMany({
        where: {
          kind: NotificationKind.CHAT,
          referenceId: params.roomId,
          metadata: { contains: `"messageId":"${params.messageId}"` },
        },
        select: { id: true, messageParams: true, metadata: true },
        orderBy: { id: "asc" },
      });

      const preview = buildChatMessagePreview(
        message === null || message.deletedAt !== null ? "" : message.content,
      );

      for (const row of rows) {
        await rewriteRow(row, params.messageId, preview, tx);
      }
    });
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        roomId: params.roomId,
        messageId: params.messageId,
        notificationType: "chat_notification_preview_rewrite",
      },
    });
  }
}
